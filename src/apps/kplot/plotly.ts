// kPlot's interactive engine: the same figure (FigureInput) as a Plotly {data, layout, config}.
// Pure TypeScript: it builds plain objects and never imports Plotly itself (PlotlyView.tsx loads
// the library lazily). Chrome colours come from the figure theme, not the OS theme.

import {
  FONT_STACKS, THEMES, resolveFigure, seriesColor,
  type AxisOpt, type Figure, type FigureInput, type LineStyle, type Marker, type Series,
} from './figure.ts'
import { markupHtml } from './markup.ts'
import { equationText, evalPoly, polyFit, r2Text } from './fit.ts'

type Obj = Record<string, unknown>
export interface PlotlyFigure {
  data: Obj[]
  layout: Obj
  config: Obj
}

/** Points (1/72 in) to CSS pixels (96 dpi). */
export const ptToPx = (pt: number): number => (pt * 96) / 72
const mmToPx = (mm: number): number => (mm * 96) / 25.4

/** The figure's size in pixels at 96 dpi. */
export function plotlySize(input: FigureInput): { width: number; height: number } {
  const f = resolveFigure(input)
  return { width: Math.round(mmToPx(f.width)), height: Math.round(mmToPx(f.height)) }
}

export function rgba(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const v = parseInt(m[1], 16)
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`
}

const SYMBOLS: Record<Marker, string> = { circle: 'circle', square: 'square', triangle: 'triangle-up', diamond: 'diamond', cross: 'x', plus: 'cross' }
const MARKER_CYCLE: Marker[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus']
const DASH: Record<LineStyle, string> = { solid: 'solid', dashed: 'dash', dotted: 'dot' }

/** ln axes are drawn as linear axes of the logarithms of the values. */
const transform = (kind: AxisOpt['scale']) => (v: number): number | null => {
  if (!Number.isFinite(v)) return null
  if (kind === 'ln') return v > 0 ? Math.log(v) : null
  return v
}
const clean = (a: number[]): (number | null)[] => a.map((v) => (Number.isFinite(v) ? v : null))

/** Where a data value goes in a shape or annotation: log axes take log10 of the value, ln axes ln. */
const place = (kind: AxisOpt['scale'], v: number): number | null => {
  if (kind === 'log10') return v > 0 ? Math.log10(v) : null
  if (kind === 'ln') return v > 0 ? Math.log(v) : null
  return v
}

export function toPlotly(input: FigureInput): PlotlyFigure {
  const f: Figure = resolveFigure(input)
  const th = THEMES[f.theme]
  const type = f.type
  const fsPx = ptToPx(f.fontSize)
  const clear = 'rgba(0,0,0,0)'
  const items = f.series.map((s, i) => ({ s, i, color: seriesColor(s, i, f.palette, f.theme) })).filter((it) => !it.s.hidden)
  const sw = (s: Series) => ptToPx(s.width || f.fontSize * 0.15)
  const ms = (s: Series) => ptToPx(s.size || f.fontSize * 0.5)
  const tx = transform(f.x.scale)
  const ty = transform(f.y.scale)
  const ty2 = transform(f.y2.scale)
  const hasRight = (type === 'xy' || type === 'area' || type === 'bar') && items.some((it) => it.s.axis === 'right')
  const categorical = type === 'bar' || type === 'stacked'
  const data: Obj[] = []
  const shapes: Obj[] = []
  const annotations: Obj[] = []
  const layout: Obj = {}

  const errBar = (s: Series, color: string): Obj | undefined => {
    if (!s.err || !s.err.some((e) => e > 0)) return undefined
    return { type: 'data', array: s.err, visible: true, color, thickness: Math.max(1, sw(s) * 0.7), width: ptToPx(f.fontSize * 0.3) }
  }

  // ---------------------------------------------------------- traces
  if (type === 'xy' || type === 'area' || type === 'scatter3d') {
    for (const { s, i, color } of items) {
      const style = (s.style || f.style) as 'line' | 'points' | 'both'
      const right = hasRight && s.axis === 'right'
      const ty_ = right ? ty2 : ty
      const mode = type === 'area' ? 'lines' : style === 'line' ? 'lines' : style === 'points' ? 'markers' : 'lines+markers'
      const symbol = SYMBOLS[(s.marker || MARKER_CYCLE[i % MARKER_CYCLE.length]) as Marker]
      const trace: Obj = {
        type: type === 'scatter3d' ? 'scatter3d' : 'scatter',
        mode: type === 'scatter3d' && style === 'line' ? 'lines' : type === 'scatter3d' && style === 'both' ? 'lines+markers' : type === 'scatter3d' ? 'markers' : mode,
        name: markupHtml(s.name),
        x: s.x.map((v) => tx(v)),
        y: s.y.map((v) => ty_(v)),
        line: { color, width: sw(s), dash: DASH[s.lineStyle ?? 'solid'] },
        marker: { symbol, size: ms(s), color, opacity: s.opacity ?? 1, line: { color, width: symbol === 'x' || symbol === 'cross' ? Math.max(1.5, ms(s) * 0.25) : 0 } },
      }
      if (type === 'scatter3d') {
        trace.z = s.z ?? s.y.map(() => 0)
        trace.marker = { size: Math.max(2, ms(s) * 0.7), color: s.z ?? color, colorscale: 'Viridis', showscale: !!s.z, opacity: s.opacity ?? 0.9 }
      } else {
        const eb = errBar(s, color)
        if (eb) trace.error_y = eb
        if (right) trace.yaxis = 'y2'
        if (type === 'area') {
          trace.fill = 'tozeroy'
          trace.fillcolor = rgba(color, s.opacity ?? 0.3)
        }
      }
      data.push(trace)
    }
    // fit lines
    if (type !== 'scatter3d') {
      f.fits.forEach((fit, k) => {
        const it = items.find((q) => q.i === fit.series)
        if (!it) return
        const xs: number[] = []
        const ys: number[] = []
        it.s.x.forEach((x, j) => { if (Number.isFinite(x) && Number.isFinite(it.s.y[j])) { xs.push(x); ys.push(it.s.y[j]) } })
        const pf = polyFit(xs, ys, fit.degree)
        if (!pf) return
        const lo = Math.min(...xs)
        const hi = Math.max(...xs)
        const px: (number | null)[] = []
        const py: (number | null)[] = []
        const right = hasRight && it.s.axis === 'right'
        for (let j = 0; j <= 120; j++) {
          const x = f.x.scale === 'log10' && lo > 0 ? lo * (hi / lo) ** (j / 120) : lo + ((hi - lo) * j) / 120
          px.push(tx(x))
          py.push((right ? ty2 : ty)(evalPoly(pf.coef, x)))
        }
        const color = fit.color || it.color
        data.push({
          type: 'scatter', mode: 'lines', x: px, y: py, name: markupHtml(`fit: ${it.s.name}`), showlegend: false, hoverinfo: 'skip',
          line: { color, width: sw(it.s), dash: 'dash' }, ...(right ? { yaxis: 'y2' } : {}),
        })
        if (fit.label) {
          annotations.push({
            xref: 'paper', yref: 'paper', x: 0.98, y: 0.04 + 0.1 * k, xanchor: 'right', yanchor: 'bottom', showarrow: false, align: 'right',
            text: `${markupHtml(equationText(pf.coef))}<br>${markupHtml(r2Text(pf.r2))}`, font: { color, size: fsPx * 0.9 }, bgcolor: clear,
          })
        }
      })
    }
  } else if (categorical) {
    const cats = f.categories ?? []
    for (const { s, color } of items) {
      const right = hasRight && type === 'bar' && s.axis === 'right'
      const t = right ? ty2 : ty
      const trace: Obj = {
        type: 'bar', name: markupHtml(s.name), x: cats, y: s.y.map((v) => t(v)),
        marker: { color, opacity: s.opacity ?? 0.9, line: { color: th.page, width: 0.5 } },
      }
      const eb = errBar(s, th.fg)
      if (eb) trace.error_y = eb
      if (right) trace.yaxis = 'y2'
      data.push(trace)
    }
    layout.barmode = type === 'stacked' ? 'stack' : 'group'
  } else if (type === 'histogram') {
    for (const { s, color } of items) {
      data.push({
        type: 'histogram', name: markupHtml(s.name), x: s.y.map((v) => tx(v)), bingroup: 'kplot', histnorm: f.histNorm === 'density' ? 'probability density' : '',
        ...(f.bins ? { nbinsx: f.bins } : {}), marker: { color, line: { color: th.page, width: 0.5 } }, opacity: s.opacity ?? (items.length > 1 ? 0.55 : 0.85),
      })
    }
    layout.barmode = 'overlay'
  } else if (type === 'box' || type === 'violin') {
    for (const { s, color } of items) {
      const base: Obj = { name: markupHtml(s.name), y: s.y.map((v) => ty(v)), line: { color, width: sw(s) }, fillcolor: rgba(color, s.opacity ?? 0.35), marker: { color }, points: 'outliers' }
      if (type === 'box') data.push({ type: 'box', boxmean: true, boxpoints: 'outliers', ...base })
      else data.push({ type: 'violin', box: { visible: true }, meanline: { visible: true }, spanmode: 'hard', ...base })
    }
    if (type === 'violin') layout.violinmode = 'group'
  } else if (type === 'heatmap' || type === 'contour' || type === 'surface') {
    const m = f.matrix
    if (m && m.z.length) {
      const colorbar = { outlinewidth: 0, tickfont: { color: th.fg }, thickness: 14 }
      if (type === 'surface') data.push({ type: 'surface', z: m.z.map(clean), x: m.xs, y: m.ys, colorscale: 'Viridis', colorbar })
      else data.push({ type, z: m.z.map(clean), x: m.xs, y: m.ys, colorscale: 'Viridis', colorbar, ...(type === 'contour' ? { contours: { coloring: 'heatmap' } } : {}), hoverongaps: false })
    }
  } else if (type === 'matrix') {
    const dims = items.map(({ s }) => ({ label: s.name, values: clean(s.y) }))
    if (dims.length) {
      data.push({ type: 'splom', dimensions: dims, marker: { color: items[0].color, size: Math.max(3, ptToPx(f.fontSize * 0.3)), opacity: 0.75 }, diagonal: { visible: true }, showupperhalf: false })
    }
  }

  // ---------------------------------------------------------- axes
  const lineW = Math.max(0.75, ptToPx(f.lineWidth || f.fontSize * 0.1))
  const axis = (a: AxisOpt, label: string, o: { right?: boolean; category?: boolean; reverseAuto?: boolean } = {}): Obj => {
    const log = a.scale === 'log10'
    const out: Obj = {
      type: o.category ? 'category' : log ? 'log' : 'linear',
      showgrid: a.grid, gridcolor: th.grid, gridwidth: Math.max(0.5, lineW * 0.8),
      zeroline: false, showline: true, linecolor: th.fg, linewidth: lineW,
      mirror: f.frame === 'box' && !o.right ? 'ticks' : false,
      ticks: f.ticksDir === 'out' ? 'outside' : 'inside', tickcolor: th.fg, tickwidth: lineW * 0.9, ticklen: Math.round(fsPx * 0.45),
      tickfont: { color: th.fg, size: fsPx * 0.9 },
      automargin: true,
      minor: { showgrid: a.grid && a.minorGrid, gridcolor: th.minorGrid, ticks: a.minorGrid || log ? (f.ticksDir === 'out' ? 'outside' : 'inside') : '', tickcolor: th.fg, ticklen: Math.round(fsPx * 0.25) },
    }
    if (label) out.title = { text: markupHtml(label), font: { color: th.fg, size: fsPx }, standoff: 6 }
    if (!o.category) out.nticks = a.ticks
    if (a.format === 'fixed') out.tickformat = `.${a.decimals}f`
    else if (a.format === 'sci') { out.tickformat = `.${a.decimals}e`; out.exponentformat = 'e' }
    else out.exponentformat = 'power'
    if (!o.category && !log && a.format === 'auto') out.tickformat = ''
    return out
  }
  /** The range from the options (null when the axis is automatic), in the units Plotly wants. */
  const rangeOf = (a: AxisOpt, vals: (number | null)[]): [number, number] | null => {
    const lo0 = a.min !== null && (a.scale === 'linear' || a.min > 0) ? a.min : null
    const hi0 = a.max !== null && (a.scale === 'linear' || a.max > 0) ? a.max : null
    if (lo0 === null && hi0 === null) return null
    const v = vals.filter((q): q is number => q !== null && Number.isFinite(q))
    const dlo = v.length ? Math.min(...v) : 0
    const dhi = v.length ? Math.max(...v) : 1
    const t = transform(a.scale)
    const lo = lo0 !== null ? t(lo0) ?? dlo : dlo
    const hi = hi0 !== null ? t(hi0) ?? dhi : dhi
    const r: [number, number] = a.scale === 'log10' ? [Math.log10(Math.max(lo, Number.MIN_VALUE)), Math.log10(Math.max(hi, Number.MIN_VALUE))] : [lo, hi]
    return a.invert ? [r[1], r[0]] : r
  }
  const valuesOf = (key: 'x' | 'y', right = false): (number | null)[] =>
    data.filter((d) => !!d.yaxis === right && Array.isArray(d[key]) && d.type !== 'box').flatMap((d) => d[key] as (number | null)[])

  if (type === 'surface' || type === 'scatter3d') {
    const ax = (label: string): Obj => ({
      title: { text: markupHtml(label), font: { color: th.fg } }, color: th.fg, gridcolor: th.grid, zerolinecolor: th.grid, backgroundcolor: th.bg ?? clear, showbackground: false,
    })
    const m = f.matrix
    layout.scene = {
      xaxis: ax(f.xLabel || (m ? 'x' : '')), yaxis: ax(f.yLabel || (m ? 'y' : '')), zaxis: ax(type === 'scatter3d' ? f.y2Label : f.y2Label || 'z'),
      bgcolor: clear, camera: { eye: { x: 1.5, y: 1.5, z: 0.9 } },
    }
  } else if (type === 'matrix') {
    const n = Math.min(items.length, 10)
    for (let k = 1; k <= n; k++) {
      const key = k === 1 ? '' : String(k)
      layout[`xaxis${key}`] = { ...axis(f.x, '', {}), showgrid: f.x.grid, title: undefined }
      layout[`yaxis${key}`] = { ...axis(f.y, '', {}), showgrid: f.y.grid, title: undefined }
    }
    layout.dragmode = 'select'
    layout.hovermode = 'closest'
  } else {
    const xAxis = axis(f.x, f.xLabel, { category: categorical })
    const xr = categorical ? null : rangeOf(f.x, valuesOf('x'))
    if (xr) { xAxis.range = xr; xAxis.autorange = false } else if (f.x.invert) xAxis.autorange = 'reversed'
    const yAxis = axis(f.y, f.yLabel)
    const yr = rangeOf(f.y, valuesOf('y', false))
    if (yr) { yAxis.range = yr; yAxis.autorange = false } else if (f.y.invert) yAxis.autorange = 'reversed'
    if (type === 'box' || type === 'violin') { xAxis.showgrid = false; xAxis.type = 'category' }
    if ((type === 'bar' || type === 'stacked' || type === 'histogram') && !yr && f.y.scale === 'linear') yAxis.rangemode = 'tozero'
    if (type === 'area' && !yr && f.y.scale === 'linear') yAxis.rangemode = 'tozero'
    layout.xaxis = xAxis
    layout.yaxis = yAxis
    if (hasRight) {
      const y2 = axis(f.y2, f.y2Label, { right: true })
      y2.overlaying = 'y'
      y2.side = 'right'
      y2.mirror = false
      const r2 = rangeOf(f.y2, valuesOf('y', true))
      if (r2) { y2.range = r2; y2.autorange = false } else if (f.y2.invert) y2.autorange = 'reversed'
      layout.yaxis2 = y2
    }
    if (f.frame === 'l') { xAxis.mirror = false; yAxis.mirror = false }
  }

  // ---------------------------------------------------------- overlays
  const refXKind = f.x.scale
  for (const r of f.lines) {
    const color = r.color || th.fg
    const line = { color, width: r.width ? ptToPx(r.width) : lineW, dash: DASH[r.lineStyle ?? 'dashed'] }
    if (r.axis === 'x') {
      const v = place(refXKind, r.value)
      if (v === null) continue
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: v, x1: v, y0: 0, y1: 1, line })
      if (r.label) annotations.push({ xref: 'x', yref: 'paper', x: v, y: 1, xanchor: 'left', yanchor: 'top', text: markupHtml(r.label), showarrow: false, font: { color, size: fsPx * 0.85 } })
    } else {
      const right = r.axis === 'y2' && hasRight
      const v = place(right ? f.y2.scale : f.y.scale, r.value)
      if (v === null) continue
      const ref = right ? 'y2' : 'y'
      shapes.push({ type: 'line', xref: 'paper', yref: ref, x0: 0, x1: 1, y0: v, y1: v, line })
      if (r.label) annotations.push({ xref: 'paper', yref: ref, x: 1, y: v, xanchor: 'right', yanchor: 'bottom', text: markupHtml(r.label), showarrow: false, font: { color, size: fsPx * 0.85 } })
    }
  }
  for (const r of f.regions) {
    const color = r.color ?? (f.palette === 'greyscale' ? th.grid : '#f5b942')
    const fill = rgba(color, r.opacity ?? 0.22)
    const scale = r.axis === 'x' ? f.x.scale : f.y.scale
    const a = place(scale, r.from)
    const b = place(scale, r.to)
    if (a === null || b === null) continue
    if (r.axis === 'x') shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0: a, x1: b, y0: 0, y1: 1, fillcolor: fill, line: { width: 0 }, layer: 'below' })
    else shapes.push({ type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: a, y1: b, fillcolor: fill, line: { width: 0 }, layer: 'below' })
    if (r.label) {
      annotations.push(r.axis === 'x'
        ? { xref: 'x', yref: 'paper', x: (a + b) / 2, y: 1, xanchor: 'center', yanchor: 'top', text: markupHtml(r.label), showarrow: false, font: { color: th.fg, size: fsPx * 0.85 } }
        : { xref: 'paper', yref: 'y', x: 0, y: (a + b) / 2, xanchor: 'left', yanchor: 'middle', text: markupHtml(r.label), showarrow: false, font: { color: th.fg, size: fsPx * 0.85 } })
    }
  }
  for (const nt of f.notes) {
    const x = place(f.x.scale, nt.x)
    const y = place(f.y.scale, nt.y)
    if (x === null || y === null) continue
    annotations.push({ xref: 'x', yref: 'y', x, y, xanchor: 'left', yanchor: 'bottom', text: markupHtml(nt.text), showarrow: false, font: { color: nt.color || th.fg, size: nt.size ? ptToPx(nt.size) : fsPx * 0.95 } })
  }

  // ---------------------------------------------------------- the page
  const legend = f.legend === 'auto' ? (items.length > 1 && type !== 'box' && type !== 'violin' ? 'top-right' : 'none') : f.legend
  const showLegend = legend !== 'none' && type !== 'heatmap' && type !== 'contour' && type !== 'surface' && type !== 'matrix'
  const legendBg = th.bg ? rgba(th.bg, 0.82) : clear
  const legendPos: Record<string, Obj> = {
    'top-left': { x: 0.02, y: 0.98, xanchor: 'left', yanchor: 'top' },
    'top-right': { x: 0.98, y: 0.98, xanchor: 'right', yanchor: 'top' },
    'bottom-left': { x: 0.02, y: 0.02, xanchor: 'left', yanchor: 'bottom' },
    'bottom-right': { x: 0.98, y: 0.02, xanchor: 'right', yanchor: 'bottom' },
    'outside-right': { x: 1.02, y: 1, xanchor: 'left', yanchor: 'top' },
    'outside-top': { x: 0.5, y: 1.02, xanchor: 'center', yanchor: 'bottom', orientation: 'h' },
  }
  layout.showlegend = showLegend
  layout.legend = { ...(legendPos[legend] ?? legendPos['top-right']), bgcolor: legendBg, bordercolor: 'rgba(0,0,0,0)', font: { color: th.fg, size: fsPx * 0.95 } }
  layout.title = f.title ? { text: markupHtml(f.title), x: 0.5, xanchor: 'center', font: { color: th.fg, size: fsPx * 1.2 } } : undefined
  layout.paper_bgcolor = th.bg ?? clear
  layout.plot_bgcolor = th.bg ?? clear
  layout.font = { family: FONT_STACKS[f.fontFamily], size: fsPx, color: th.fg }
  layout.margin = { l: 56, r: 24, t: f.title ? 52 : legend === 'outside-top' ? 44 : 20, b: 48 }
  layout.autosize = true
  layout.hovermode = layout.hovermode ?? 'closest'
  layout.hoverlabel = { bgcolor: th.bg ?? '#ffffff', font: { color: th.fg }, bordercolor: th.grid }
  layout.modebar = { bgcolor: clear, color: th.bg ? rgba(th.fg, 0.55) : 'rgba(0,0,0,0.5)', activecolor: th.fg }
  layout.shapes = shapes
  layout.annotations = annotations
  layout.colorway = items.map((it) => it.color)
  // the zoom the user made is kept while the data changes, and reset when the ranges or scales are edited
  layout.uirevision = JSON.stringify([type, f.x.min, f.x.max, f.y.min, f.y.max, f.y2.min, f.y2.max, f.x.scale, f.y.scale, f.y2.scale, f.x.invert, f.y.invert, f.y2.invert])

  const config: Obj = {
    displaylogo: false, responsive: false, scrollZoom: true, displayModeBar: true,
    modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d'],
    toImageButtonOptions: { format: 'png', filename: 'kplot', scale: 2 },
  }
  return { data, layout, config }
}
