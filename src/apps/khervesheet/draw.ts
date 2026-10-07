// Drawing the grid on a canvas: only the visible cells, in four panes when
// rows or columns are frozen, then the headers. Cell colours are adapted to
// the dark grid (colors.ts); the selection, the copied range's marching
// ants, the fill-handle preview and the references of the formula being
// typed are drawn on top.

import { adaptBorder, adaptFill, adaptText, withAlpha } from './colors'
import type { Axis } from './geom'
import type { RefToken } from './formula'
import { fmtLoopPeriod } from './pytext'

export { fmtLoopPeriod }
import {
  H_MASK, V_MASK, isError, isPython, key, mergeRange, rangeSize, type Border, type Cell, type Fmt, type Merge, type Range,
  type Selection, type Sheet,
} from './model'

export interface Theme {
  bg: string
  surface: string
  chrome: string
  text: string
  muted: string
  accent: string
  border: string
  danger: string
  link: string
  font: string
}

export interface View {
  /** CSS pixels of the canvas. */
  width: number
  height: number
  /** Logical scroll of the main pane. */
  scrollX: number
  scrollY: number
  zoom: number
  dpr: number
  /** Header sizes (logical). */
  hw: number
  hh: number
}

export interface Marks {
  sel: Selection
  /** The cell being edited (its text is hidden under the editor). */
  edit: { r: number; c: number } | null
  refs: RefToken[]
  ants: Range | null
  antsPhase: number
  fill: Range | null
  formulas: boolean
  gridlines: boolean
  headings: boolean
  colLabel: (c: number) => string
  /** Cell sheet-name for references (lower case). */
  sheetName: string
  /** Notes, checkboxes, drop-downs and links of the sheet (by "r,c"). */
  notes: Set<string>
  checks: Set<string>
  drops: Set<string>
  links: Set<string>
}

export const DEFAULT_FONT_PT = 9
export const LINE_PAD = 3

/** A cell format's CSS font. */
export function cellFont(f: Fmt | undefined, family: string): string {
  const px = ((f?.font_size ?? DEFAULT_FONT_PT) * 4) / 3
  const fam = f?.font_family ? `"${f.font_family.replace(/"/g, '')}", ${family}` : family
  return `${f?.italic ? 'italic ' : ''}${f?.bold ? '700 ' : ''}${px.toFixed(1)}px ${fam}`
}

const widthCache = new Map<string, Map<string, number>>()

export function measure(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  let m = widthCache.get(font)
  if (!m) {
    m = new Map()
    widthCache.set(font, m)
  }
  let w = m.get(text)
  if (w === undefined) {
    ctx.font = font
    w = ctx.measureText(text).width
    if (m.size > 5000) m.clear()
    m.set(text, w)
  }
  return w
}

interface Pane {
  r0: number
  r1: number
  c0: number
  c1: number
  /** Screen position of logical sheet coordinates: x = xOff + cols.pos(c). */
  xOff: number
  yOff: number
  clip: { x: number; y: number; w: number; h: number }
}

/** What a cell shows: its text, or its formula in Formulas view. */
export function shownText(cell: Cell | undefined, formulas: boolean): string {
  if (!cell) return ''
  if (formulas && cell.s.startsWith('=')) return cell.s
  return cell.t
}

export function drawGrid(ctx: CanvasRenderingContext2D, sh: Sheet, rows: Axis, cols: Axis, v: View, th: Theme, mk: Marks) {
  const z = v.zoom
  ctx.setTransform(v.dpr * z, 0, 0, v.dpr * z, 0, 0)
  const W = v.width / z
  const H = v.height / z
  const hw = mk.headings ? v.hw : 0
  const hh = mk.headings ? v.hh : 0
  const fr = Math.min(sh.freeze[0], sh.rows)
  const fc = Math.min(sh.freeze[1], sh.cols)
  const FH = rows.pos(fr)
  const FW = cols.pos(fc)
  ctx.fillStyle = th.bg
  ctx.fillRect(0, 0, W, H)

  const rA = rows.at(v.scrollY + FH)
  const rB = rows.at(v.scrollY + H - hh)
  const cA = cols.at(v.scrollX + FW)
  const cB = cols.at(v.scrollX + W - hw)
  const panes: Pane[] = [
    { r0: Math.max(rA, fr), r1: rB, c0: Math.max(cA, fc), c1: cB, xOff: hw - v.scrollX, yOff: hh - v.scrollY, clip: { x: hw + FW, y: hh + FH, w: W - hw - FW, h: H - hh - FH } },
  ]
  if (fr > 0) panes.push({ r0: 0, r1: fr - 1, c0: Math.max(cA, fc), c1: cB, xOff: hw - v.scrollX, yOff: hh, clip: { x: hw + FW, y: hh, w: W - hw - FW, h: FH } })
  if (fc > 0) panes.push({ r0: Math.max(rA, fr), r1: rB, c0: 0, c1: fc - 1, xOff: hw, yOff: hh - v.scrollY, clip: { x: hw, y: hh + FH, w: FW, h: H - hh - FH } })
  if (fr > 0 && fc > 0) panes.push({ r0: 0, r1: fr - 1, c0: 0, c1: fc - 1, xOff: hw, yOff: hh, clip: { x: hw, y: hh, w: FW, h: FH } })

  for (const p of panes) {
    if (p.clip.w <= 0 || p.clip.h <= 0) continue
    ctx.save()
    ctx.beginPath()
    ctx.rect(p.clip.x, p.clip.y, p.clip.w, p.clip.h)
    ctx.clip()
    drawCells(ctx, sh, rows, cols, p, z, th, mk)
    drawMarks(ctx, sh, rows, cols, p, z, th, mk)
    ctx.restore()
  }

  if (mk.headings) drawHeaders(ctx, sh, rows, cols, v, th, mk, { fr, fc, FH, FW, rA, rB, cA, cB, W, H })
  // Frozen-pane dividers.
  ctx.lineWidth = 1.5 / z
  ctx.strokeStyle = th.muted
  if (fr > 0) line(ctx, hw, hh + FH, W, hh + FH)
  if (fc > 0) line(ctx, hw + FW, hh, hw + FW, H)
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

const DASH: Record<number, number[]> = { 2: [4, 2], 3: [1, 2], 4: [4, 2, 1, 2], 5: [4, 2, 1, 2, 1, 2] }

function drawBorder(ctx: CanvasRenderingContext2D, b: Border | undefined, x1: number, y1: number, x2: number, y2: number, bg: string, z: number) {
  if (!b || !b.style) return
  ctx.strokeStyle = adaptBorder(b.color, bg)
  ctx.lineWidth = Math.max(1 / z, (b.width || 1) * 0.9)
  ctx.setLineDash((DASH[b.style] ?? []).map((d) => d / z))
  line(ctx, x1, y1, x2, y2)
  ctx.setLineDash([])
}

function drawCells(ctx: CanvasRenderingContext2D, sh: Sheet, rows: Axis, cols: Axis, p: Pane, z: number, th: Theme, mk: Marks) {
  const X = (c: number) => p.xOff + cols.pos(c)
  const Y = (r: number) => p.yOff + rows.pos(r)
  // Text does not run across the frozen columns' edge.
  const cMin = sh.freeze[1] > 0 && p.c0 >= sh.freeze[1] ? sh.freeze[1] : 0
  const right = p.clip.x + p.clip.w
  const bottom = p.clip.y + p.clip.h

  // Merges touching the pane, and the cells they cover.
  const merges: Merge[] = []
  const covered = new Set<number>()
  for (const m of sh.merges) {
    const g = mergeRange(m)
    if (g.r2 < p.r0 || g.r1 > p.r1 || g.c2 < p.c0 || g.c1 > p.c1) continue
    merges.push(m)
    if (rangeSize(g) <= 4000) for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) covered.add(key(r, c))
  }

  // 1. Gridlines.
  if (mk.gridlines) {
    ctx.strokeStyle = th.border
    ctx.lineWidth = 1 / z
    ctx.beginPath()
    for (let c = p.c0; c <= p.c1 + 1; c++) {
      const x = Math.round(X(c) * z) / z - 0.5 / z
      if (x < p.clip.x - 1 || x > right + 1) continue
      ctx.moveTo(x, p.clip.y)
      ctx.lineTo(x, bottom)
    }
    for (let r = p.r0; r <= p.r1 + 1; r++) {
      if (r < sh.rows && !rows.visible(r) && r <= p.r1) continue
      const y = Math.round(Y(r) * z) / z - 0.5 / z
      if (y < p.clip.y - 1 || y > bottom + 1) continue
      ctx.moveTo(p.clip.x, y)
      ctx.lineTo(right, y)
    }
    ctx.stroke()
  }

  const bgOf = (f: Fmt | undefined) => adaptFill(f?.bg) ?? th.bg

  // 2. Fills (cells and merges).
  const fillCell = (r: number, c: number, x: number, y: number, w: number, h: number) => {
    const k = key(r, c)
    const f = sh.formats.get(k)
    const fill = adaptFill(f?.bg)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fillRect(x - 0.5 / z, y - 0.5 / z, w, h)
    }
    const cell = sh.cells.get(k)
    if (cell && isPython(cell.s)) {
      ctx.fillStyle = 'rgba(91, 155, 213, 0.10)'
      ctx.fillRect(x, y, w - 1 / z, h - 1 / z)
    }
  }
  for (let r = p.r0; r <= p.r1; r++) {
    const h = rows.size(r)
    if (!h) continue
    const y = Y(r)
    for (let c = p.c0; c <= p.c1; c++) {
      const k = key(r, c)
      if (covered.has(k)) continue
      if (!sh.formats.has(k) && !sh.cells.get(k)?.s.startsWith('=')) continue
      fillCell(r, c, X(c), y, cols.size(c), h)
    }
  }
  for (const m of merges) {
    const g = mergeRange(m)
    const x = X(g.c1)
    const y = Y(g.r1)
    const w = cols.pos(g.c2 + 1) - cols.pos(g.c1)
    const h = rows.pos(g.r2 + 1) - rows.pos(g.r1)
    ctx.fillStyle = bgOf(sh.formats.get(key(g.r1, g.c1)))
    ctx.fillRect(x, y, w - 1 / z, h - 1 / z)
    fillCell(g.r1, g.c1, x, y, w, h)
  }

  // 3. Text.
  const textCell = (r: number, c: number, x: number, y: number, w: number, h: number, merged: boolean) => {
    if (mk.edit && mk.edit.r === r && mk.edit.c === c) return
    const k = key(r, c)
    const cell = sh.cells.get(k)
    const rc = `${r},${c}`
    if (mk.checks.has(rc)) {
      drawCheckbox(ctx, x, y, h, (cell?.t ?? '').toUpperCase() === 'TRUE', th, z)
      return
    }
    const text = shownText(cell, mk.formulas)
    if (!text) return
    const f = sh.formats.get(k)
    const bg = bgOf(f)
    const font = cellFont(f, th.font)
    ctx.font = font
    const pending = sh.pending.has(k)
    const link = mk.links.has(rc)
    let color = f?.font_color ? adaptText(f.font_color, bg, th.text) : th.text
    if (pending) color = th.muted
    else if (link) color = th.link
    else if (!f?.font_color && isError(text)) color = th.danger
    ctx.fillStyle = color
    const px = ((f?.font_size ?? DEFAULT_FONT_PT) * 4) / 3
    const halign = (f?.alignment ?? 0) & H_MASK
    const valign = (f?.alignment ?? 0) & V_MASK
    const isNum = !!cell && cell.n !== null && !mk.formulas
    const wrap = !!f?.wrap_text
    const tw = measure(ctx, text, font)
    let avail = w - 2 * LINE_PAD
    let clipW = w
    // Text runs on into empty cells to the right (Excel), when left-aligned.
    if (!wrap && !merged && !isNum && tw > avail && (halign === 0 || halign === 0x1)) {
      let cc = c + 1
      let extra = 0
      while (tw > avail + extra && cc < sh.cols && cc <= p.c1 + 40) {
        const kk = key(r, cc)
        const other = sh.cells.get(kk)
        if ((other && (other.t || other.s)) || covered.has(kk) || mk.checks.has(`${r},${cc}`)) break
        extra += cols.size(cc)
        cc++
      }
      if (extra) {
        // Hide the gridlines the text crosses.
        ctx.fillStyle = th.bg
        ctx.fillRect(x + w - 1 / z, y, extra, h - 1 / z)
        ctx.fillStyle = color
        clipW = w + extra
        avail += extra
      }
    }
    const lines = wrap ? wrapLines(ctx, text, font, avail) : [text]
    const lh = px * 1.2
    const block = lines.length * lh
    let ty: number
    if (valign === 0x20) ty = y + LINE_PAD + lh / 2
    else if (valign === 0x40) ty = y + h - LINE_PAD - block + lh / 2
    else ty = y + h / 2 - block / 2 + lh / 2
    ctx.textBaseline = 'middle'
    const needClip = tw > avail || block > h || lines.length > 1
    if (needClip) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, clipW - 1 / z, h - 1 / z)
      ctx.clip()
    }
    for (const ln of lines) {
      const lw = lines.length > 1 ? measure(ctx, ln, font) : tw
      let tx = x + LINE_PAD
      if (halign === 0x2) tx = x + w - LINE_PAD - lw
      else if (halign === 0x4) tx = x + (w - lw) / 2
      ctx.textAlign = 'left'
      ctx.fillText(ln, tx, ty)
      if (f?.underline || link) {
        ctx.fillRect(tx, ty + px * 0.45, lw, Math.max(1 / z, px / 14))
      }
      ty += lh
    }
    if (needClip) ctx.restore()
  }

  for (let r = p.r0; r <= p.r1; r++) {
    const h = rows.size(r)
    if (!h) continue
    const y = Y(r)
    // Long text from a cell left of the pane may run into it.
    for (let c = p.c0 - 1; c >= Math.max(cMin, p.c0 - 32); c--) {
      const cell = sh.cells.get(key(r, c))
      if (!cell?.t && !cell?.s) continue
      if (cell.n === null && !covered.has(key(r, c)) && !mk.checks.has(`${r},${c}`)) textCell(r, c, X(c), y, cols.size(c), h, false)
      break
    }
    for (let c = p.c0; c <= p.c1; c++) {
      const k = key(r, c)
      if (covered.has(k)) continue
      const w = cols.size(c)
      if (!w) continue
      if (sh.cells.has(k) || mk.checks.has(`${r},${c}`)) textCell(r, c, X(c), y, w, h, false)
    }
  }
  for (const m of merges) {
    const g = mergeRange(m)
    textCell(g.r1, g.c1, X(g.c1), Y(g.r1), cols.pos(g.c2 + 1) - cols.pos(g.c1), rows.pos(g.r2 + 1) - rows.pos(g.r1), true)
  }

  // 4. Borders and marks in the cells.
  for (let r = p.r0; r <= p.r1; r++) {
    const h = rows.size(r)
    if (!h) continue
    const y = Y(r)
    for (let c = p.c0; c <= p.c1; c++) {
      const k = key(r, c)
      const f = sh.formats.get(k)
      const x = X(c)
      const w = cols.size(c)
      if (f && (f.b_top || f.b_bottom || f.b_left || f.b_right)) {
        const bg = adaptFill(f.bg) ?? th.bg
        drawBorder(ctx, f.b_top, x, y, x + w, y, bg, z)
        drawBorder(ctx, f.b_bottom, x, y + h, x + w, y + h, bg, z)
        drawBorder(ctx, f.b_left, x, y, x, y + h, bg, z)
        drawBorder(ctx, f.b_right, x + w, y, x + w, y + h, bg, z)
      }
      const rc = `${r},${c}`
      if (mk.notes.has(rc)) {
        ctx.fillStyle = '#e04848'
        ctx.beginPath()
        ctx.moveTo(x + w - 7, y)
        ctx.lineTo(x + w - 1 / z, y)
        ctx.lineTo(x + w - 1 / z, y + 7)
        ctx.fill()
      }
      if (mk.drops.has(rc)) {
        ctx.fillStyle = th.muted
        ctx.beginPath()
        ctx.moveTo(x + w - 11, y + h / 2 - 2)
        ctx.lineTo(x + w - 4, y + h / 2 - 2)
        ctx.lineTo(x + w - 7.5, y + h / 2 + 2.5)
        ctx.fill()
      }
      const cell = sh.cells.get(k)
      if (cell && isPython(cell.s) && w > 26 && h > 8) {
        // The desktop's faint Python tint over the cell, and the "PY"
        // badge down its right edge (CellFormatDelegate).
        ctx.fillStyle = 'rgba(55, 118, 171, 0.047)'
        ctx.fillRect(x, y, w, h)
        const loop = Number(sh.pyLoops[rc]) || null
        drawPyBadge(ctx, x + w - 20, y, 20, h, loop, th.font)
      }
    }
  }
  drawSparklines(ctx, sh, X, Y, rows, cols, p, th)
}

export const PY_BLUE = '#3776ab'
export const PY_YELLOW = '#ffd43b'

/**
 * The desktop's raised two-tone "PY" badge (python_engine.paint_py_badge):
 * Python blue over yellow, two white "eyes", "PY" in white; a looping cell
 * shows "PY", a refresh arrow and its period instead of the eyes.
 */
export function drawPyBadge(ctx: CanvasRenderingContext2D, x0: number, y0: number, w0: number, h0: number, loop: number | null, family = 'sans-serif') {
  const x = x0 + 1.5
  const y = y0 + 1.5
  const w = w0 - 3
  const h = h0 - 3
  if (w <= 1 || h <= 1) return
  const radius = Math.min(6, w * 0.4)
  ctx.save()
  const path = new Path2D()
  path.roundRect(x, y, w, h, radius)
  ctx.save()
  ctx.clip(path)
  const half = h / 2
  ctx.fillStyle = PY_BLUE
  ctx.fillRect(x, y, w, half)
  ctx.fillStyle = PY_YELLOW
  ctx.fillRect(x, y + half, w, h - half)
  if (loop === null) {
    const dot = Math.max(1, w * 0.12)
    const dx = w * 0.17
    const dy = h * 0.17
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(x + w / 2 - dx, y + dy, dot, 0, Math.PI * 2)
    ctx.arc(x + w / 2 + dx, y + h - dy, dot, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  // Raised bevel: light inner edge, darker outer edge.
  ctx.lineWidth = 1.2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.59)'
  const inner = new Path2D()
  inner.roundRect(x + 0.6, y + 0.6, w - 1.2, h - 1.2, radius)
  ctx.stroke(inner)
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.31)'
  ctx.stroke(path)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const pt = (v: number) => v * 1.333
  if (loop === null) {
    ctx.font = `bold ${pt(Math.max(6.5, Math.min(9.5, w * 0.42)))}px ${family}`
    ctx.fillStyle = 'rgba(0, 0, 0, 0.43)'
    ctx.fillText('PY', x + w / 2 + 0.6, y + h / 2 + 0.9)
    ctx.fillStyle = '#ffffff'
    ctx.fillText('PY', x + w / 2, y + h / 2)
  } else {
    ctx.font = `bold ${pt(Math.max(6, Math.min(8.5, w * 0.38)))}px ${family}`
    ctx.fillStyle = '#ffffff'
    ctx.fillText('PY', x + w / 2, y + (h * 0.52) / 2)
    const by = y + h * 0.5 + (h * 0.5) / 2
    const cx = x + w / 2 - w * 0.22
    const rad = Math.max(2, w * 0.14)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(1, rad * 0.35)
    ctx.lineCap = 'round'
    ctx.beginPath()
    // ~300 degrees, counter-clockwise from 105 degrees (Qt angles).
    ctx.arc(cx, by, rad, (-105 * Math.PI) / 180, (195 * Math.PI) / 180)
    ctx.stroke()
    const a = (105 * Math.PI) / 180
    const ex = cx + rad * Math.cos(a)
    const ey = by - rad * Math.sin(a)
    const hh = rad * 0.7
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(ex + hh, ey - hh * 0.2)
    ctx.lineTo(ex - hh * 0.2, ey - hh)
    ctx.lineTo(ex - hh * 0.3, ey + hh * 0.3)
    ctx.fill()
    ctx.font = `bold ${pt(Math.max(5.5, Math.min(7.5, w * 0.3)))}px ${family}`
    ctx.fillStyle = 'rgba(0, 0, 0, 0.63)'
    ctx.fillText(fmtLoopPeriod(loop), x + w / 2 + w * 0.1, by)
  }
  ctx.restore()
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, font: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/)
    let lineText = ''
    for (const w of words) {
      const next = lineText + w
      if (lineText && measure(ctx, next.trimEnd(), font) > width) {
        out.push(lineText.trimEnd())
        lineText = w.trimStart()
      } else lineText = next
    }
    out.push(lineText.trimEnd())
  }
  return out
}

function drawCheckbox(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, on: boolean, th: Theme, z: number) {
  const s = Math.min(13, h - 6)
  const bx = x + 4
  const by = y + (h - s) / 2
  ctx.lineWidth = 1.2 / z
  ctx.strokeStyle = on ? th.accent : th.muted
  ctx.fillStyle = on ? th.accent : 'transparent'
  ctx.beginPath()
  ctx.roundRect(bx, by, s, s, 2.5)
  if (on) ctx.fill()
  ctx.stroke()
  if (on) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.8 / z
    ctx.beginPath()
    ctx.moveTo(bx + s * 0.22, by + s * 0.52)
    ctx.lineTo(bx + s * 0.43, by + s * 0.73)
    ctx.lineTo(bx + s * 0.8, by + s * 0.28)
    ctx.stroke()
  }
}

function drawSparklines(
  ctx: CanvasRenderingContext2D, sh: Sheet, X: (c: number) => number, Y: (r: number) => number, rows: Axis, cols: Axis, p: Pane, th: Theme,
) {
  const sp = sh.insertOps.sparklines
  if (!sp) return
  for (const [rc, s] of Object.entries(sp)) {
    const [r, c] = rc.split(',').map(Number)
    if (r < p.r0 || r > p.r1 || c < p.c0 || c > p.c1 || !s) continue
    const vals: number[] = []
    for (let rr = s.r1; rr <= s.r2 && rr - s.r1 < 2000; rr++) {
      const cell = sh.cells.get(key(rr, s.col))
      const v = cell ? (cell.n ?? Number(cell.t)) : NaN
      if (Number.isFinite(v)) vals.push(v)
    }
    if (vals.length < 2) continue
    const x = X(c) + 3
    const y = Y(r) + 3
    const w = cols.size(c) - 6
    const h = rows.size(r) - 6
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    const span = hi - lo || 1
    const color = adaptText(s.color ?? '#4472c4', th.bg, th.accent)
    ctx.strokeStyle = color
    ctx.fillStyle = color
    if (s.type === 'bar' || s.type === 'winloss') {
      const bw = w / vals.length
      vals.forEach((v, i) => {
        if (s.type === 'winloss') {
          const up = v >= 0
          ctx.fillStyle = up ? color : th.danger
          ctx.fillRect(x + i * bw + 0.5, up ? y : y + h / 2, Math.max(1, bw - 1), h / 2)
        } else {
          const bh = ((v - Math.min(0, lo)) / (hi - Math.min(0, lo) || 1)) * h
          ctx.fillRect(x + i * bw + 0.5, y + h - bh, Math.max(1, bw - 1), bh)
        }
      })
    } else {
      ctx.lineWidth = 1.2
      ctx.beginPath()
      vals.forEach((v, i) => {
        const px = x + (i / (vals.length - 1)) * w
        const py = y + h - ((v - lo) / span) * h
        if (i) ctx.lineTo(px, py)
        else ctx.moveTo(px, py)
      })
      ctx.stroke()
    }
  }
}

function rangeRect(rows: Axis, cols: Axis, p: Pane, g: Range) {
  const x = p.xOff + cols.pos(g.c1)
  const y = p.yOff + rows.pos(g.r1)
  return { x, y, w: cols.pos(g.c2 + 1) - cols.pos(g.c1), h: rows.pos(g.r2 + 1) - rows.pos(g.r1) }
}

function drawMarks(ctx: CanvasRenderingContext2D, sh: Sheet, rows: Axis, cols: Axis, p: Pane, z: number, th: Theme, mk: Marks) {
  const sel = mk.sel
  const act = sel.active
  const am = sh.merges.find((m) => act.r >= m[0] && act.r < m[0] + m[2] && act.c >= m[1] && act.c < m[1] + m[3])
  const activeRange = am ? mergeRange(am) : { r1: act.r, c1: act.c, r2: act.r, c2: act.c }
  const ar = rangeRect(rows, cols, p, activeRange)
  // Selection tint (not over the active cell).
  ctx.fillStyle = withAlpha(th.accent, 0.16)
  for (const g of sel.ranges) {
    if (g.r1 === g.r2 && g.c1 === g.c2) continue
    const q = rangeRect(rows, cols, p, g)
    ctx.save()
    ctx.beginPath()
    ctx.rect(q.x, q.y, q.w, q.h)
    ctx.rect(ar.x, ar.y, ar.w, ar.h)
    ctx.clip('evenodd')
    ctx.fillRect(q.x, q.y, q.w, q.h)
    ctx.restore()
  }
  // Formula references while typing.
  for (const t of mk.refs) {
    if (t.sheet && t.sheet.toLowerCase() !== mk.sheetName) continue
    const q = rangeRect(rows, cols, p, t.range)
    ctx.fillStyle = withAlpha(t.color, 0.14)
    ctx.fillRect(q.x, q.y, q.w, q.h)
    ctx.strokeStyle = t.color
    ctx.lineWidth = 1.5 / z
    ctx.strokeRect(q.x + 0.75 / z, q.y + 0.75 / z, q.w - 1.5 / z, q.h - 1.5 / z)
  }
  // Range outlines; the active cell.
  ctx.strokeStyle = th.accent
  sel.ranges.forEach((g, i) => {
    const q = rangeRect(rows, cols, p, g)
    ctx.lineWidth = (i === sel.ranges.length - 1 ? 2 : 1) / z
    ctx.strokeRect(q.x + 0.5 / z, q.y + 0.5 / z, q.w - 1 / z, q.h - 1 / z)
  })
  ctx.lineWidth = 2 / z
  ctx.strokeRect(ar.x + 1 / z, ar.y + 1 / z, ar.w - 2 / z, ar.h - 2 / z)
  // The fill handle.
  const last = sel.ranges[sel.ranges.length - 1]
  if (!mk.edit) {
    const q = rangeRect(rows, cols, p, last)
    const s = 6 / z
    ctx.fillStyle = th.bg
    ctx.fillRect(q.x + q.w - s / 2 - 1 / z, q.y + q.h - s / 2 - 1 / z, s + 2 / z, s + 2 / z)
    ctx.fillStyle = th.accent
    ctx.fillRect(q.x + q.w - s / 2, q.y + q.h - s / 2, s, s)
  }
  if (mk.fill) {
    const q = rangeRect(rows, cols, p, mk.fill)
    ctx.setLineDash([3 / z, 3 / z])
    ctx.lineWidth = 1.5 / z
    ctx.strokeStyle = th.muted
    ctx.strokeRect(q.x + 0.75 / z, q.y + 0.75 / z, q.w - 1.5 / z, q.h - 1.5 / z)
    ctx.setLineDash([])
  }
  if (mk.ants) {
    const q = rangeRect(rows, cols, p, mk.ants)
    ctx.setLineDash([4 / z, 3 / z])
    ctx.lineDashOffset = -mk.antsPhase / z
    ctx.lineWidth = 2 / z
    ctx.strokeStyle = th.accent
    ctx.strokeRect(q.x + 1 / z, q.y + 1 / z, q.w - 2 / z, q.h - 2 / z)
    ctx.setLineDash([])
    ctx.lineDashOffset = 0
  }
  // AutoFilter buttons on the header row.
  const f = sh.filter
  if (f && f.range.r1 >= p.r0 && f.range.r1 <= p.r1) {
    for (let c = Math.max(f.range.c1, p.c0); c <= Math.min(f.range.c2, p.c1); c++) {
      const q = rangeRect(rows, cols, p, { r1: f.range.r1, c1: c, r2: f.range.r1, c2: c })
      const s = Math.min(16, q.h - 3)
      const bx = q.x + q.w - s - 2
      const by = q.y + (q.h - s) / 2
      const on = f.keep[c] !== undefined
      ctx.fillStyle = on ? th.accent : th.chrome
      ctx.strokeStyle = th.border
      ctx.lineWidth = 1 / z
      ctx.beginPath()
      ctx.roundRect(bx, by, s, s, 3)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = on ? '#ffffff' : th.text
      ctx.beginPath()
      ctx.moveTo(bx + s * 0.25, by + s * 0.38)
      ctx.lineTo(bx + s * 0.75, by + s * 0.38)
      ctx.lineTo(bx + s * 0.5, by + s * 0.68)
      ctx.fill()
    }
  }
}

function drawHeaders(
  ctx: CanvasRenderingContext2D, sh: Sheet, rows: Axis, cols: Axis, v: View, th: Theme, mk: Marks,
  g: { fr: number; fc: number; FH: number; FW: number; rA: number; rB: number; cA: number; cB: number; W: number; H: number },
) {
  const z = v.zoom
  const { hw, hh } = v
  const sel = mk.sel
  const colSel = new Set<number>()
  const colFull = new Set<number>()
  const rowSel = new Set<number>()
  const rowFull = new Set<number>()
  for (const s of sel.ranges) {
    for (let c = Math.max(s.c1, 0); c <= s.c2 && c - s.c1 < 20000; c++) {
      colSel.add(c)
      if (s.r1 === 0 && s.r2 >= sh.rows - 1) colFull.add(c)
    }
    const rTop = Math.max(s.r1, 0)
    const rBot = Math.min(s.r2, Math.max(g.rB, g.fr) + 1)
    for (let r = rTop; r <= rBot; r++) {
      rowSel.add(r)
      if (s.c1 === 0 && s.c2 >= sh.cols - 1) rowFull.add(r)
    }
  }
  const font = `${(11).toFixed(0)}px ${th.font}`
  ctx.font = font
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'

  // Column header strip.
  ctx.fillStyle = th.chrome
  ctx.fillRect(hw, 0, g.W - hw, hh)
  const colSpans: [number, number, number, boolean][] = []
  if (g.fc > 0) colSpans.push([0, g.fc - 1, hw, true])
  colSpans.push([Math.max(g.cA, g.fc), g.cB, hw - v.scrollX, false])
  for (const [c0, c1, off, frozen] of colSpans) {
    ctx.save()
    ctx.beginPath()
    if (frozen) ctx.rect(hw, 0, g.FW, hh)
    else ctx.rect(hw + g.FW, 0, g.W - hw - g.FW, hh)
    ctx.clip()
    for (let c = c0; c <= c1; c++) {
      const w = cols.size(c)
      if (!w) continue
      const x = off + cols.pos(c)
      if (colSel.has(c)) {
        ctx.fillStyle = withAlpha(th.accent, colFull.has(c) ? 0.45 : 0.2)
        ctx.fillRect(x, 0, w, hh)
      }
      ctx.fillStyle = colSel.has(c) ? th.text : th.muted
      ctx.fillText(mk.colLabel(c), x + w / 2, hh / 2 + 0.5)
      ctx.strokeStyle = th.border
      ctx.lineWidth = 1 / z
      line(ctx, x + w - 0.5 / z, 0, x + w - 0.5 / z, hh)
      if (colSel.has(c)) {
        ctx.strokeStyle = th.accent
        ctx.lineWidth = 2 / z
        line(ctx, x, hh - 1 / z, x + w, hh - 1 / z)
      }
    }
    ctx.restore()
  }

  // Row header strip.
  ctx.fillStyle = th.chrome
  ctx.fillRect(0, hh, hw, g.H - hh)
  const rowSpans: [number, number, number, boolean][] = []
  if (g.fr > 0) rowSpans.push([0, g.fr - 1, hh, true])
  rowSpans.push([Math.max(g.rA, g.fr), g.rB, hh - v.scrollY, false])
  for (const [r0, r1, off, frozen] of rowSpans) {
    ctx.save()
    ctx.beginPath()
    if (frozen) ctx.rect(0, hh, hw, g.FH)
    else ctx.rect(0, hh + g.FH, hw, g.H - hh - g.FH)
    ctx.clip()
    for (let r = r0; r <= r1; r++) {
      const h = rows.size(r)
      if (!h) continue
      const y = off + rows.pos(r)
      if (rowSel.has(r)) {
        ctx.fillStyle = withAlpha(th.accent, rowFull.has(r) ? 0.45 : 0.2)
        ctx.fillRect(0, y, hw, h)
      }
      ctx.fillStyle = rowSel.has(r) ? th.text : sh.hidden.has(r - 1) || sh.hidden.has(r + 1) ? th.accent : th.muted
      if (h >= 9) ctx.fillText(String(r + 1), hw / 2, y + h / 2 + 0.5)
      ctx.strokeStyle = th.border
      ctx.lineWidth = 1 / z
      line(ctx, 0, y + h - 0.5 / z, hw, y + h - 0.5 / z)
      if (rowSel.has(r)) {
        ctx.strokeStyle = th.accent
        ctx.lineWidth = 2 / z
        line(ctx, hw - 1 / z, y, hw - 1 / z, y + h)
      }
    }
    ctx.restore()
  }

  // Corner (select all) and the header edges.
  ctx.fillStyle = th.chrome
  ctx.fillRect(0, 0, hw, hh)
  ctx.fillStyle = th.muted
  ctx.beginPath()
  ctx.moveTo(hw - 4, hh - 13)
  ctx.lineTo(hw - 4, hh - 4)
  ctx.lineTo(hw - 13, hh - 4)
  ctx.fill()
  ctx.strokeStyle = th.border
  ctx.lineWidth = 1 / z
  line(ctx, 0, hh - 0.5 / z, g.W, hh - 0.5 / z)
  line(ctx, hw - 0.5 / z, 0, hw - 0.5 / z, g.H)
  ctx.textAlign = 'left'
}

/** Row header width for the row numbers on screen. */
export function headerWidth(lastRow: number): number {
  const digits = String(lastRow + 1).length
  return Math.max(40, 12 + digits * 7.5)
}
