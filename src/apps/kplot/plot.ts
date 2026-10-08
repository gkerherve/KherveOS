// kPlot's SVG engine: a publication-style figure (data in, SVG text out). It draws scatter /
// line, area, grouped and stacked bars, histograms and box plots with linear / log10 / ln
// axes, a second y axis, error bars, fit lines, reference lines, notes and shaded regions.
// The window shows this SVG (Publication engine) and exports it as it is. Pure TypeScript.

import {
  FONT_STACKS, THEMES, mmToPt, resolveFigure, seriesColor, svgType,
  type FigureInput, type Marker, type Series,
} from './figure.ts'
import { markupSvg, markupWidth } from './markup.ts'
import { boxStats, autoBins, evalPoly, equationText, histogram, polyFit, r2Text } from './fit.ts'
import { categoryScale, makeScale, type Scale } from './scale.ts'

export { niceTicks } from './scale.ts'
export { escapeXml } from './markup.ts'
export { COLORS } from './figure.ts'
export type { PlotStyle, Series } from './figure.ts'
/** The old name of the input (title, xLabel, yLabel, style and series are enough). */
export type PlotSpec = FigureInput

const n = (v: number): string => String(Math.round(v * 100) / 100)

/** The SVG element of one marker, `d` points across, centred on (cx, cy). */
export function markerSvg(shape: Marker, cx: number, cy: number, d: number, color: string, opacity = 1): string {
  const r = d / 2
  const fill = `fill="${color}"${opacity < 1 ? ` fill-opacity="${n(opacity)}"` : ''}`
  switch (shape) {
    case 'square': return `<rect x="${n(cx - r * 0.88)}" y="${n(cy - r * 0.88)}" width="${n(r * 1.76)}" height="${n(r * 1.76)}" ${fill}/>`
    case 'triangle': return `<polygon points="${n(cx)},${n(cy - r * 1.1)} ${n(cx + r * 1.05)},${n(cy + r * 0.85)} ${n(cx - r * 1.05)},${n(cy + r * 0.85)}" ${fill}/>`
    case 'diamond': return `<polygon points="${n(cx)},${n(cy - r * 1.25)} ${n(cx + r * 1.25)},${n(cy)} ${n(cx)},${n(cy + r * 1.25)} ${n(cx - r * 1.25)},${n(cy)}" ${fill}/>`
    case 'cross': {
      const a = r * 0.85
      return `<path d="M${n(cx - a)} ${n(cy - a)}L${n(cx + a)} ${n(cy + a)}M${n(cx - a)} ${n(cy + a)}L${n(cx + a)} ${n(cy - a)}" fill="none" stroke="${color}" stroke-width="${n(d * 0.26)}"/>`
    }
    case 'plus': return `<path d="M${n(cx - r)} ${n(cy)}L${n(cx + r)} ${n(cy)}M${n(cx)} ${n(cy - r)}L${n(cx)} ${n(cy + r)}" fill="none" stroke="${color}" stroke-width="${n(d * 0.26)}"/>`
    default: return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${fill}/>`
  }
}

const MARKER_CYCLE: Marker[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus']

const dashAttr = (ls: string | undefined, w: number): string =>
  ls === 'dashed' ? ` stroke-dasharray="${n(w * 4)} ${n(w * 2.2)}"` : ls === 'dotted' ? ` stroke-dasharray="${n(w * 0.1)} ${n(w * 2.4)}" stroke-linecap="round"` : ''

interface Ext { min: number; max: number }
function extent(): { add(v: number): void; get(): Ext | null } {
  let min = Infinity
  let max = -Infinity
  return {
    add: (v) => { if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v } },
    get: () => (min <= max ? { min, max } : null),
  }
}

interface Item { s: Series; i: number; color: string }

/** The SVG text of the figure. Empty series are drawn as an empty frame. */
export function plotSvg(input: FigureInput): string {
  const f = resolveFigure(input)
  const type = svgType(f.type)
  const th = THEMES[f.theme]
  const fs = f.fontSize
  const W = mmToPt(f.width)
  const H = mmToPt(f.height)
  const lw = f.lineWidth || fs * 0.1
  const items: Item[] = f.series.map((s, i) => ({ s, i, color: seriesColor(s, i, f.palette, f.theme) })).filter((it) => !it.s.hidden)
  const swidth = (s: Series) => s.width || fs * 0.15
  const msize = (s: Series) => s.size || fs * 0.5
  const hasRightAxis = type === 'xy' || type === 'area' || type === 'bar'
  const onRight = (it: Item) => hasRightAxis && it.s.axis === 'right'
  const categorical = type === 'bar' || type === 'stacked' || type === 'box'

  // ---------------------------------------------------------- data → extents → scales
  const xOk = (v: number) => Number.isFinite(v) && (f.x.scale === 'linear' || v > 0)
  const yOkOf = (right: boolean) => { const k = (right ? f.y2 : f.y).scale; return (v: number) => Number.isFinite(v) && (k === 'linear' || v > 0) }
  const xe = extent()
  const ye = extent()
  const y2e = extent()
  const ext = (it: Item) => (onRight(it) ? y2e : ye)
  let names: string[] = []
  const nCat = Math.max(f.categories?.length ?? 0, ...items.map((it) => it.s.y.length), 0)
  let hist: { edges: number[]; counts: number[]; density: number[] }[] = []
  let boxes: (ReturnType<typeof boxStats>)[] = []
  const stackBase: number[][] = [] // stacked bars: the bottom of each bar
  const stackTop: number[][] = []

  if (type === 'xy' || type === 'area') {
    for (const it of items) {
      const ok = yOkOf(onRight(it))
      it.s.x.forEach((x, k) => {
        const y = it.s.y[k]
        if (!xOk(x) || !ok(y)) return
        xe.add(x)
        const e = it.s.err?.[k] ?? 0
        ext(it).add(y)
        if (e > 0) { ext(it).add(y + e); if (ok(y - e)) ext(it).add(y - e) }
      })
    }
  } else if (type === 'bar' || type === 'stacked') {
    names = Array.from({ length: nCat }, (_, k) => f.categories?.[k] ?? String(k + 1))
    const pos = new Array<number>(nCat).fill(0)
    const neg = new Array<number>(nCat).fill(0)
    for (const it of items) {
      const ok = yOkOf(onRight(it) && type === 'bar')
      const base: number[] = []
      const top: number[] = []
      for (let k = 0; k < nCat; k++) {
        const y = it.s.y[k]
        if (!Number.isFinite(y) || (type === 'bar' && !ok(y))) { base.push(NaN); top.push(NaN); continue }
        if (type === 'stacked') {
          const b = y >= 0 ? pos[k] : neg[k]
          base.push(b)
          top.push(b + y)
          if (y >= 0) pos[k] += y; else neg[k] += y
          ye.add(b + y)
        } else {
          base.push(NaN)
          top.push(y)
          const e = it.s.err?.[k] ?? 0
          ext(it).add(y)
          if (e > 0) { ext(it).add(y + e); ext(it).add(y - e) }
        }
      }
      stackBase.push(base)
      stackTop.push(top)
    }
  } else if (type === 'histogram') {
    const all = items.flatMap((it) => it.s.y.filter((v) => Number.isFinite(v)))
    const nb = f.bins || autoBins(Math.max(0, ...items.map((it) => it.s.y.filter((v) => Number.isFinite(v)).length)))
    const lo = all.length ? Math.min(...all) : 0
    const hi = all.length ? Math.max(...all) : 1
    hist = items.map((it) => histogram(it.s.y, nb, lo, hi))
    for (const h of hist) {
      xe.add(h.edges[0]); xe.add(h.edges[h.edges.length - 1])
      for (const v of f.histNorm === 'density' ? h.density : h.counts) ye.add(v)
    }
  } else {
    names = items.map((it) => it.s.name)
    const ok = yOkOf(false)
    boxes = items.map((it) => boxStats(it.s.y.filter(ok)))
    for (const b of boxes) if (b) { ye.add(b.lo); ye.add(b.hi); b.outliers.forEach((v) => ye.add(v)) }
  }

  const needZero = type === 'bar' || type === 'stacked' || type === 'histogram' || type === 'area'
  const xs: Scale = categorical ? categoryScale(names, f.x.invert) : makeScale(xe.get(), f.x, { exact: type === 'histogram', pad: 0.03 })
  const ys: Scale = makeScale(ye.get(), f.y, { zero: needZero, pad: 0.03 })
  const hasY2 = hasRightAxis && items.some(onRight)
  const y2s: Scale | null = hasY2 ? makeScale(y2e.get(), f.y2, { zero: needZero, pad: 0.03 }) : null
  const scaleOf = (it: Item) => (onRight(it) && y2s ? y2s : ys)

  // ---------------------------------------------------------- legend and margins
  const wantLegend = f.legend === 'auto' ? (items.length > 1 && type !== 'box' ? 'top-right' : 'none') : f.legend
  const legendEntries = wantLegend === 'none' ? [] : items
  const lgFs = fs * 0.95
  const rowH = fs * 1.4
  const sampleW = type === 'xy' ? fs * 2 : fs * 1
  const textW = Math.max(0, ...legendEntries.map((it) => markupWidth(it.s.name, lgFs)))
  const legW = fs * 1 + sampleW + fs * 0.4 + textW
  const legH = legendEntries.length * rowH + fs * 0.4

  const tickFs = fs * 0.9
  const pad = fs * 0.7
  const tl = fs * 0.5
  const gap = fs * 0.35
  const outTick = f.ticksDir === 'out' ? tl : 0
  const maxTickW = (sc: Scale) => Math.max(0, ...sc.major.map((t) => markupWidth(t.text, tickFs)))
  const labH = fs * 1.35

  let left = pad + (f.yLabel ? labH : 0) + maxTickW(ys) + outTick + gap
  let right = pad
  if (y2s) right += (f.y2Label ? labH : 0) + maxTickW(y2s) + outTick + gap
  const xTickHalf = (xs.major.length ? Math.max(markupWidth(xs.major[0].text, tickFs), markupWidth(xs.major[xs.major.length - 1].text, tickFs)) : 0) / 2
  left = Math.max(left, pad + xTickHalf)
  right = Math.max(right, pad + xTickHalf)
  let top = pad + (f.title ? fs * 1.5 : 0)
  top = Math.max(top, pad + tickFs * 0.5)
  if (wantLegend === 'outside-right' && legendEntries.length) right += fs * 0.8 + legW
  let topRows: Item[][] = []
  if (wantLegend === 'outside-top' && legendEntries.length) {
    const avail = Math.max(60, W - 2 * pad)
    let row: Item[] = []
    let used = 0
    for (const it of legendEntries) {
      const w = sampleW + fs * 0.4 + markupWidth(it.s.name, lgFs) + fs * 1.2
      if (row.length && used + w > avail) { topRows.push(row); row = []; used = 0 }
      row.push(it)
      used += w
    }
    if (row.length) topRows.push(row)
    top += topRows.length * rowH + fs * 0.4
  } else topRows = []
  const plotWEst = Math.max(40, W - left - right)
  const catW = categorical ? xs.major.map((t) => markupWidth(t.text, tickFs)) : []
  const rotateCats = categorical && catW.reduce((a, b) => a + b, 0) + catW.length * fs * 0.6 > plotWEst
  const tickBlock = rotateCats ? Math.sin(Math.PI / 4) * Math.max(...catW) + tickFs * 0.8 : tickFs * 1.1
  const bottom = pad * 0.6 + (f.xLabel ? fs * 1.5 : 0) + tickBlock + outTick + gap

  const pl = left
  const pr = Math.max(left + 20, W - right)
  const pt = top
  const pb = Math.max(top + 20, H - bottom)
  const px = (v: number) => pl + xs.frac(v) * (pr - pl)
  const pyOf = (sc: Scale, v: number) => pb - sc.frac(v) * (pb - pt)

  // ---------------------------------------------------------- drawing
  const out: string[] = []
  const text = (x: number, y: number, markup: string, o: { size?: number; anchor?: string; fill?: string; weight?: string; rotate?: number } = {}) => {
    const size = o.size ?? fs
    const tr = o.rotate ? ` transform="rotate(${o.rotate} ${n(x)} ${n(y)})"` : ''
    out.push(`<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}" text-anchor="${o.anchor ?? 'start'}" fill="${o.fill ?? th.fg}"${o.weight ? ` font-weight="${o.weight}"` : ''}${tr}>${markupSvg(markup, size)}</text>`)
  }
  const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, w: number, extra = '') =>
    out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${stroke}" stroke-width="${n(w)}"${extra}/>`)

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}" width="${n(f.width)}mm" height="${n(f.height)}mm" font-family='${FONT_STACKS[f.fontFamily]}'>`)
  if (th.bg) out.push(`<rect width="${n(W)}" height="${n(H)}" fill="${th.bg}"/>`)
  out.push(`<defs><clipPath id="kp-clip"><rect x="${n(pl)}" y="${n(pt)}" width="${n(pr - pl)}" height="${n(pb - pt)}"/></clipPath></defs>`)

  // grid
  const gridLines = (sc: Scale, vertical: boolean, major: boolean, minor: boolean) => {
    const at = (v: number) => (vertical ? px(v) : pyOf(sc, v))
    const seg = (p: number, color: string, w: number) =>
      vertical ? line(p, pt, p, pb, color, w) : line(pl, p, pr, p, color, w)
    if (minor) for (const v of sc.minor) seg(at(v), th.minorGrid, lw * 0.6)
    if (major) for (const t of sc.major) seg(at(t.v), th.grid, lw * 0.8)
  }
  gridLines(xs, true, f.x.grid, f.x.minorGrid && f.x.grid)
  gridLines(ys, false, f.y.grid, f.y.minorGrid && f.y.grid)
  if (y2s && f.y2.grid) gridLines(y2s, false, true, f.y2.minorGrid)

  // shaded regions (under the data)
  for (const r of f.regions) {
    const lo = Math.min(r.from, r.to)
    const hi = Math.max(r.from, r.to)
    const color = r.color ?? (f.palette === 'greyscale' ? th.grid : '#f5b942')
    const op = r.opacity ?? 0.22
    if (r.axis === 'x') {
      const a = px(lo)
      const b = px(hi)
      out.push(`<rect x="${n(Math.min(a, b))}" y="${n(pt)}" width="${n(Math.abs(b - a))}" height="${n(pb - pt)}" fill="${color}" fill-opacity="${op}" clip-path="url(#kp-clip)"/>`)
      if (r.label) text((a + b) / 2, pt + fs * 1.1, r.label, { size: fs * 0.85, anchor: 'middle' })
    } else {
      const a = pyOf(ys, lo)
      const b = pyOf(ys, hi)
      out.push(`<rect x="${n(pl)}" y="${n(Math.min(a, b))}" width="${n(pr - pl)}" height="${n(Math.abs(b - a))}" fill="${color}" fill-opacity="${op}" clip-path="url(#kp-clip)"/>`)
      if (r.label) text(pl + fs * 0.5, Math.min(a, b) + fs * 1.0, r.label, { size: fs * 0.85 })
    }
  }

  // series
  out.push('<g clip-path="url(#kp-clip)">')
  const eqLines: { text: string; color: string }[] = []

  if (type === 'xy' || type === 'area') {
    items.forEach((it) => {
      const s = it.s
      const sc = scaleOf(it)
      const ok = (k: number) => xs.ok(s.x[k]) && sc.ok(s.y[k])
      const style = (s.style || f.style) as 'line' | 'points' | 'both'
      const w = swidth(s)
      const segs: [number, number, number][][] = []
      let cur: [number, number, number][] = []
      for (let k = 0; k < s.x.length; k++) {
        if (!ok(k)) { if (cur.length) segs.push(cur); cur = []; continue }
        cur.push([px(s.x[k]), pyOf(sc, s.y[k]), k])
      }
      if (cur.length) segs.push(cur)
      if (type === 'area') {
        const base = pyOf(sc, sc.kind === 'linear' ? Math.min(Math.max(0, sc.lo), sc.hi) : sc.lo)
        for (const sg of segs) {
          const d = sg.map(([a, b]) => `${n(a)},${n(b)}`).join(' ')
          out.push(`<polygon points="${n(sg[0][0])},${n(base)} ${d} ${n(sg[sg.length - 1][0])},${n(base)}" fill="${it.color}" fill-opacity="${n(s.opacity ?? 0.3)}"/>`)
        }
      }
      if (style !== 'points' || type === 'area') {
        for (const sg of segs) {
          if (sg.length < 2) continue
          out.push(`<polyline points="${sg.map(([a, b]) => `${n(a)},${n(b)}`).join(' ')}" fill="none" stroke="${it.color}" stroke-width="${n(w)}" stroke-linejoin="round"${dashAttr(s.lineStyle, w)}/>`)
        }
      }
      if (s.err) {
        const cap = fs * 0.3
        for (const sg of segs) {
          for (const [a, , k] of sg) {
            const e = s.err[k]
            if (!(e > 0)) continue
            const top2 = pyOf(sc, s.y[k] + e)
            const lowV = s.y[k] - e
            const bot = sc.ok(lowV) ? pyOf(sc, lowV) : pyOf(sc, sc.lo)
            out.push(`<path d="M${n(a)} ${n(top2)}L${n(a)} ${n(bot)}M${n(a - cap)} ${n(top2)}L${n(a + cap)} ${n(top2)}M${n(a - cap)} ${n(bot)}L${n(a + cap)} ${n(bot)}" fill="none" stroke="${it.color}" stroke-width="${n(w * 0.7)}"/>`)
          }
        }
      }
      if (style !== 'line' && type !== 'area') {
        const shape = (s.marker || MARKER_CYCLE[it.i % MARKER_CYCLE.length]) as Marker
        for (const sg of segs) for (const [a, b] of sg) out.push(markerSvg(shape, a, b, msize(s), it.color, s.opacity ?? 1))
      }
    })
    // fit lines
    for (const fit of f.fits) {
      const it = items.find((q) => q.i === fit.series)
      if (!it) continue
      const sc = scaleOf(it)
      const fx: number[] = []
      const fy: number[] = []
      it.s.x.forEach((x, k) => { if (Number.isFinite(x) && Number.isFinite(it.s.y[k])) { fx.push(x); fy.push(it.s.y[k]) } })
      const pf = polyFit(fx, fy, fit.degree)
      if (!pf) continue
      const lo = Math.min(...fx)
      const hi = Math.max(...fx)
      const pts: string[] = []
      for (let k = 0; k <= 120; k++) {
        const x = xs.kind === 'linear' || lo <= 0 ? lo + ((hi - lo) * k) / 120 : lo * (hi / lo) ** (k / 120)
        const y = evalPoly(pf.coef, x)
        if (xs.ok(x) && sc.ok(y)) pts.push(`${n(px(x))},${n(Math.min(pb + 1e4, Math.max(pt - 1e4, pyOf(sc, y))))}`)
      }
      const w = swidth(it.s)
      const color = fit.color || it.color
      if (pts.length > 1) out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="${n(w)}" stroke-dasharray="${n(w * 4)} ${n(w * 2.2)}"/>`)
      if (fit.label) {
        eqLines.push({ text: equationText(pf.coef), color })
        eqLines.push({ text: r2Text(pf.r2), color })
      }
    }
  } else if (type === 'bar' || type === 'stacked') {
    const m = items.length
    const group = type === 'bar'
    const bw = group ? 0.8 / Math.max(1, m) : 0.6
    items.forEach((it, j) => {
      const sc = scaleOf(it)
      const w = swidth(it.s)
      const op = it.s.opacity ?? 0.9
      for (let k = 0; k < nCat; k++) {
        const top2 = stackTop[j][k]
        if (!Number.isFinite(top2)) continue
        const c = group ? k + (j - (m - 1) / 2) * bw : k
        const x0 = px(c - bw / 2)
        const x1 = px(c + bw / 2)
        const baseV = group ? (sc.kind === 'linear' ? Math.min(Math.max(0, sc.lo), sc.hi) : sc.lo) : stackBase[j][k]
        const ya = pyOf(sc, baseV)
        const yb = pyOf(sc, top2)
        out.push(`<rect x="${n(Math.min(x0, x1))}" y="${n(Math.min(ya, yb))}" width="${n(Math.abs(x1 - x0))}" height="${n(Math.abs(ya - yb))}" fill="${it.color}" fill-opacity="${n(op)}" stroke="${th.page}" stroke-width="${n(lw * 0.4)}"/>`)
        const e = it.s.err?.[k] ?? 0
        if (e > 0) {
          const cx = (x0 + x1) / 2
          const ea = pyOf(sc, top2 + e)
          const eb = sc.ok(top2 - e) ? pyOf(sc, top2 - e) : pyOf(sc, sc.lo)
          const cap = Math.min(fs * 0.3, Math.abs(x1 - x0) / 3)
          out.push(`<path d="M${n(cx)} ${n(ea)}L${n(cx)} ${n(eb)}M${n(cx - cap)} ${n(ea)}L${n(cx + cap)} ${n(ea)}M${n(cx - cap)} ${n(eb)}L${n(cx + cap)} ${n(eb)}" fill="none" stroke="${th.fg}" stroke-width="${n(w * 0.6)}"/>`)
        }
      }
    })
  } else if (type === 'histogram') {
    items.forEach((it, j) => {
      const h = hist[j]
      const vals = f.histNorm === 'density' ? h.density : h.counts
      const op = it.s.opacity ?? (items.length > 1 ? 0.55 : 0.85)
      const ya = pyOf(ys, ys.kind === 'linear' ? Math.min(Math.max(0, ys.lo), ys.hi) : ys.lo)
      vals.forEach((v, b) => {
        if (!ys.ok(v)) return
        const x0 = px(h.edges[b])
        const x1 = px(h.edges[b + 1])
        const yb = pyOf(ys, v)
        out.push(`<rect x="${n(Math.min(x0, x1))}" y="${n(Math.min(ya, yb))}" width="${n(Math.abs(x1 - x0))}" height="${n(Math.abs(ya - yb))}" fill="${it.color}" fill-opacity="${n(op)}" stroke="${th.page}" stroke-width="${n(lw * 0.4)}"/>`)
      })
    })
  } else {
    items.forEach((it, j) => {
      const b = boxes[j]
      if (!b) return
      const w = swidth(it.s)
      const c = px(j)
      const half = Math.abs(px(j + 0.25) - px(j))
      const yv = (v: number) => pyOf(ys, v)
      const cap = half * 0.5
      out.push(`<path d="M${n(c)} ${n(yv(b.q3))}L${n(c)} ${n(yv(b.hi))}M${n(c - cap)} ${n(yv(b.hi))}L${n(c + cap)} ${n(yv(b.hi))}M${n(c)} ${n(yv(b.q1))}L${n(c)} ${n(yv(b.lo))}M${n(c - cap)} ${n(yv(b.lo))}L${n(c + cap)} ${n(yv(b.lo))}" fill="none" stroke="${it.color}" stroke-width="${n(w)}"/>`)
      const y1 = yv(b.q3)
      const y2 = yv(b.q1)
      out.push(`<rect x="${n(c - half)}" y="${n(Math.min(y1, y2))}" width="${n(half * 2)}" height="${n(Math.abs(y2 - y1))}" fill="${it.color}" fill-opacity="${n(it.s.opacity ?? 0.35)}" stroke="${it.color}" stroke-width="${n(w)}"/>`)
      out.push(`<line x1="${n(c - half)}" y1="${n(yv(b.median))}" x2="${n(c + half)}" y2="${n(yv(b.median))}" stroke="${it.color}" stroke-width="${n(w * 1.6)}"/>`)
      out.push(markerSvg('plus', c, yv(b.mean), fs * 0.45, it.color))
      for (const o of b.outliers) out.push(`<circle cx="${n(c)}" cy="${n(yv(o))}" r="${n(fs * 0.17)}" fill="none" stroke="${it.color}" stroke-width="${n(w * 0.7)}"/>`)
    })
  }

  // reference lines
  for (const r of f.lines) {
    const sc = r.axis === 'y2' && y2s ? y2s : ys
    const color = r.color || th.fg
    const w = r.width || lw * 0.9
    if (r.axis === 'x') {
      if (!xs.ok(r.value)) continue
      const x = px(r.value)
      line(x, pt, x, pb, color, w, dashAttr(r.lineStyle ?? 'dashed', w))
      if (r.label) text(x + fs * 0.3, pt + fs * 1.0, r.label, { size: fs * 0.85, fill: color })
    } else {
      if (!sc.ok(r.value)) continue
      const y = pyOf(sc, r.value)
      line(pl, y, pr, y, color, w, dashAttr(r.lineStyle ?? 'dashed', w))
      if (r.label) text(pr - fs * 0.3, y - fs * 0.3, r.label, { size: fs * 0.85, fill: color, anchor: 'end' })
    }
  }
  // notes
  for (const nt of f.notes) {
    if (!xs.ok(nt.x) || !ys.ok(nt.y)) continue
    text(px(nt.x), pyOf(ys, nt.y), nt.text, { size: nt.size ?? fs * 0.95, fill: nt.color || th.fg })
  }
  out.push('</g>')

  // frame, axes, ticks
  const sw = lw
  const frameD = f.frame === 'box' ? `M${n(pl)} ${n(pt)}H${n(pr)}V${n(pb)}H${n(pl)}Z` : `M${n(pl)} ${n(pt)}V${n(pb)}H${n(pr)}${y2s ? `V${n(pt)}` : ''}`
  out.push(`<path d="${frameD}" fill="none" stroke="${th.fg}" stroke-width="${n(sw)}" stroke-linejoin="miter"/>`)
  const dir = f.ticksDir === 'out' ? 1 : -1
  const tickPath: string[] = []
  const tick = (x1: number, y1: number, x2: number, y2: number) => tickPath.push(`M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`)
  const minorX = (f.x.minorGrid || xs.kind === 'log10') && !categorical
  for (const t of xs.major) {
    const x = px(t.v)
    tick(x, pb, x, pb + dir * tl)
    if (f.frame === 'box') tick(x, pt, x, pt - dir * tl)
  }
  if (minorX) for (const v of xs.minor) { const x = px(v); tick(x, pb, x, pb + dir * tl * 0.5); if (f.frame === 'box') tick(x, pt, x, pt - dir * tl * 0.5) }
  const minorY = f.y.minorGrid || ys.kind === 'log10'
  for (const t of ys.major) {
    const y = pyOf(ys, t.v)
    tick(pl, y, pl - dir * tl, y)
    if (f.frame === 'box' && !y2s) tick(pr, y, pr + dir * tl, y)
  }
  if (minorY) for (const v of ys.minor) { const y = pyOf(ys, v); tick(pl, y, pl - dir * tl * 0.5, y); if (f.frame === 'box' && !y2s) tick(pr, y, pr + dir * tl * 0.5, y) }
  if (y2s) {
    for (const t of y2s.major) { const y = pyOf(y2s, t.v); tick(pr, y, pr + dir * tl, y) }
    if (f.y2.minorGrid || y2s.kind === 'log10') for (const v of y2s.minor) { const y = pyOf(y2s, v); tick(pr, y, pr + dir * tl * 0.5, y) }
  }
  out.push(`<path d="${tickPath.join('')}" fill="none" stroke="${th.fg}" stroke-width="${n(sw * 0.9)}"/>`)

  // tick labels
  const xBase = pb + outTick + gap + tickFs * 0.8
  for (const t of xs.major) {
    const x = px(t.v)
    if (rotateCats) text(x + tickFs * 0.3, xBase - tickFs * 0.1, t.text, { size: tickFs, anchor: 'end', rotate: -45 })
    else text(x, xBase, t.text, { size: tickFs, anchor: 'middle' })
  }
  for (const t of ys.major) text(pl - outTick - gap, pyOf(ys, t.v) + tickFs * 0.34, t.text, { size: tickFs, anchor: 'end' })
  if (y2s) for (const t of y2s.major) text(pr + outTick + gap, pyOf(y2s, t.v) + tickFs * 0.34, t.text, { size: tickFs })

  // axis labels and title
  if (f.xLabel) text((pl + pr) / 2, xBase + (rotateCats ? tickBlock - tickFs : tickFs * 0.3) + fs * 1.0, f.xLabel, { anchor: 'middle' })
  if (f.yLabel) text(pad + fs * 0.95, (pt + pb) / 2, f.yLabel, { anchor: 'middle', rotate: -90 })
  if (y2s && f.y2Label) text(W - pad - fs * 0.95, (pt + pb) / 2, f.y2Label, { anchor: 'middle', rotate: 90 })
  if (f.title) text(W / 2, pad + fs * 1.0, f.title, { size: fs * 1.2, anchor: 'middle', weight: '600' })

  // legend
  const legendSample = (it: Item, x: number, y: number) => {
    const s = it.s
    if (type === 'xy') {
      const style = (s.style || f.style) as 'line' | 'points' | 'both'
      const w = swidth(s)
      if (style !== 'points') out.push(`<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + sampleW)}" y2="${n(y)}" stroke="${it.color}" stroke-width="${n(w)}"${dashAttr(s.lineStyle, w)}/>`)
      if (style !== 'line') out.push(markerSvg((s.marker || MARKER_CYCLE[it.i % MARKER_CYCLE.length]) as Marker, x + sampleW / 2, y, msize(s), it.color, s.opacity ?? 1))
    } else {
      out.push(`<rect x="${n(x)}" y="${n(y - fs * 0.35)}" width="${n(sampleW)}" height="${n(fs * 0.7)}" fill="${it.color}" fill-opacity="${n(s.opacity ?? 0.8)}"/>`)
    }
  }
  const inset = fs * 0.6
  if (legendEntries.length && wantLegend !== 'outside-top') {
    let x0: number
    let y0: number
    if (wantLegend === 'outside-right') { x0 = pr + fs * 0.8; y0 = pt } else {
      x0 = wantLegend.endsWith('left') ? pl + inset : pr - inset - legW
      y0 = wantLegend.startsWith('top') ? pt + inset : pb - inset - legH
      out.push(`<rect x="${n(x0)}" y="${n(y0)}" width="${n(legW)}" height="${n(legH)}" fill="${th.bg ?? th.page}" fill-opacity="0.82" stroke="${th.grid}" stroke-width="${n(lw * 0.5)}"/>`)
    }
    legendEntries.forEach((it, k) => {
      const y = y0 + fs * 0.2 + rowH * (k + 0.5)
      legendSample(it, x0 + fs * 0.5, y)
      text(x0 + fs * 0.5 + sampleW + fs * 0.4, y + lgFs * 0.34, it.s.name, { size: lgFs })
    })
  } else if (topRows.length) {
    topRows.forEach((row, r) => {
      const widths = row.map((it) => sampleW + fs * 0.4 + markupWidth(it.s.name, lgFs) + fs * 1.2)
      let x = (W - widths.reduce((a, b) => a + b, 0) + fs * 1.2) / 2
      const y = pad + (f.title ? fs * 1.5 : 0) + rowH * (r + 0.5)
      row.forEach((it, k) => {
        legendSample(it, x, y)
        text(x + sampleW + fs * 0.4, y + lgFs * 0.34, it.s.name, { size: lgFs })
        x += widths[k]
      })
    })
  }

  // fit equations, in the first corner the legend does not use
  if (eqLines.length) {
    const corners = ['bottom-right', 'bottom-left', 'top-left', 'top-right'].filter((c) => c !== wantLegend)
    const corner = corners[0]
    const right2 = corner.endsWith('right')
    const eqSize = fs * 0.9
    eqLines.forEach((q, k) => {
      const fromTop = corner.startsWith('top')
      const y = fromTop ? pt + inset + eqSize * 1.25 * (k + 1) : pb - inset - eqSize * 1.25 * (eqLines.length - 1 - k) - eqSize * 0.2
      text(right2 ? pr - inset : pl + inset, y, q.text, { size: eqSize, anchor: right2 ? 'end' : 'start', fill: q.color })
    })
  }

  out.push('</svg>')
  return out.join('\n')
}
