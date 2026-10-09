// A small static chart as SVG text (pure), for the Plot block in exports, PDF and the print sheet. The editor shows
// the same data with Plotly (loaded lazily); this is also its fallback.

import type { PlotData } from './blocks.ts'
import { cellNumber } from './reaction.ts'

export interface PlotStyle {
  width: number
  height: number
  /** print: black on white; app: uses the theme's CSS variables. */
  scheme: 'print' | 'app'
}

const PRINT = { text: '#222', grid: '#ddd', axis: '#555', bg: '#fff', series: ['#1f6feb', '#d1242f', '#1a7f37', '#9a6700', '#8250df', '#0969da'] }
const APP = { text: 'var(--k-text)', grid: 'var(--k-border)', axis: 'var(--k-muted)', bg: 'none', series: ['var(--k-accent)', 'var(--k-danger)', 'var(--k-success)', 'var(--k-warning)', 'var(--k-link)', 'var(--k-muted)'] }

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Round tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)))
  return out
}

const tickLabel = (v: number): string => (Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(1).replace('e+', 'e') : String(Number(v.toPrecision(6))))

/** The numbers of a plot: x values (or null for a text category) and one array per series. */
export function plotData(d: PlotData): { x: (number | null)[]; labels: string[]; y: (number | null)[][] } {
  const labels = d.rows.map((r) => r[0] ?? '')
  const x = d.rows.map((r) => cellNumber(r[0] ?? ''))
  const y = d.series.map((_, s) => d.rows.map((r) => cellNumber(r[s + 1] ?? '')))
  return { x, labels, y }
}

export function plotSvg(d: PlotData, style: PlotStyle): string {
  const { width: W, height: H } = style
  const c = style.scheme === 'print' ? PRINT : APP
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif" font-size="11">`
  const { x, labels, y } = plotData(d)
  const any = y.some((s) => s.some((v) => v != null))
  if (!any) return `${head}<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="${c.axis}">No numbers to plot yet</text></svg>`
  const bar = d.kind === 'bar'
  const categorical = bar || x.some((v) => v == null)
  const xs = categorical ? x.map((_, i) => i) : (x as number[])
  const ml = 56, mr = 14, mt = 26, mb = 44
  const pw = W - ml - mr, ph = H - mt - mb
  const flat = y.flat().filter((v): v is number => v != null)
  let y0 = Math.min(...flat, bar ? 0 : Infinity), y1 = Math.max(...flat, bar ? 0 : -Infinity)
  if (y0 === y1) { y0 -= 1; y1 += 1 }
  const yt = niceTicks(y0, y1)
  y0 = Math.min(y0, yt[0]); y1 = Math.max(y1, yt[yt.length - 1])
  let x0 = Math.min(...xs), x1 = Math.max(...xs)
  if (categorical) { x0 = -0.5; x1 = xs.length - 0.5 } else if (x0 === x1) { x0 -= 1; x1 += 1 }
  const xt = categorical ? [] : niceTicks(x0, x1)
  const px = (v: number): number => ml + ((v - x0) / (x1 - x0)) * pw
  const py = (v: number): number => mt + ph - ((v - y0) / (y1 - y0)) * ph
  const out: string[] = [head]
  if (c.bg !== 'none') out.push(`<rect width="${W}" height="${H}" fill="${c.bg}"/>`)
  for (const t of yt) out.push(`<line x1="${ml}" x2="${W - mr}" y1="${py(t).toFixed(1)}" y2="${py(t).toFixed(1)}" stroke="${c.grid}"/><text x="${ml - 6}" y="${(py(t) + 4).toFixed(1)}" text-anchor="end" fill="${c.text}">${tickLabel(t)}</text>`)
  for (const t of xt) out.push(`<line y1="${mt}" y2="${mt + ph}" x1="${px(t).toFixed(1)}" x2="${px(t).toFixed(1)}" stroke="${c.grid}"/><text x="${px(t).toFixed(1)}" y="${mt + ph + 15}" text-anchor="middle" fill="${c.text}">${tickLabel(t)}</text>`)
  if (categorical) labels.forEach((l, i) => out.push(`<text x="${px(i).toFixed(1)}" y="${mt + ph + 15}" text-anchor="middle" fill="${c.text}">${esc(l.slice(0, 12))}</text>`))
  out.push(`<rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="none" stroke="${c.axis}"/>`)
  y.forEach((ser, s) => {
    const col = c.series[s % c.series.length]
    const pts = ser.map((v, i) => (v == null ? null : [px(xs[i]), py(v)] as const))
    if (bar) {
      const bw = Math.max(2, (pw / xs.length / (y.length + 0.6)))
      pts.forEach((p, i) => {
        if (!p) return
        const bx = px(i) - (bw * y.length) / 2 + s * bw
        out.push(`<rect x="${bx.toFixed(1)}" y="${Math.min(p[1], py(0)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(py(0) - p[1]).toFixed(1)}" fill="${col}"/>`)
      })
      return
    }
    if (d.kind === 'line') {
      let path = ''
      let pen = false
      for (const p of pts) {
        if (!p) { pen = false; continue }
        path += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`
        pen = true
      }
      if (path) out.push(`<path d="${path}" fill="none" stroke="${col}" stroke-width="1.6"/>`)
    }
    for (const p of pts) if (p) out.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${d.kind === 'line' ? 2.2 : 3.2}" fill="${col}"/>`)
  })
  if (d.title) out.push(`<text x="${ml}" y="15" font-weight="bold" fill="${c.text}">${esc(d.title)}</text>`)
  out.push(`<text x="${ml + pw / 2}" y="${H - 6}" text-anchor="middle" fill="${c.text}">${esc(d.xLabel)}</text>`)
  out.push(`<text transform="translate(13 ${mt + ph / 2}) rotate(-90)" text-anchor="middle" fill="${c.text}">${esc(d.yLabel)}</text>`)
  d.series.forEach((n, s) => out.push(`<text x="${W - mr - 4}" y="${15 + s * 13}" text-anchor="end" fill="${c.series[s % c.series.length]}">${esc(n)}</text>`))
  out.push('</svg>')
  return out.join('')
}
