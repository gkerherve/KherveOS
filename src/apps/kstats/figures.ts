// The charts of kStats as plain Plotly figures ({ data, layout }): the fit with its confidence band,
// the residuals, a histogram, box plots and the correlation heat-map. Pure (no browser, no Plotly
// import): PlotlyChart.tsx loads Plotly lazily and draws these. Colours come in as a palette that
// the window reads from the theme variables.

import { curve, type FitResult } from './fits.ts'
import { histogram, mean, sd } from './math.ts'
import type { CorrMatrix } from './tests.ts'

export type Trace = Record<string, unknown>
export interface Figure {
  data: Trace[]
  layout: Record<string, unknown>
}

/** CSS colours (rgb(...) or #hex) resolved from the theme. */
export interface Palette {
  text: string
  muted: string
  border: string
  accent: string
  link: string
  danger: string
  /** A neutral between the two ends of the heat-map. */
  surface: string
}

export const DEFAULT_PALETTE: Palette = {
  text: '#e5e7eb', muted: '#9ca3af', border: '#374151', accent: '#34d399', link: '#60a5fa', danger: '#f87171', surface: '#1f2937',
}

/** "rgb(1, 2, 3)" or "#abc" / "#aabbcc" with an alpha → "rgba(1, 2, 3, a)". */
export function withAlpha(color: string, alpha: number): string {
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(color)
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`
  }
  return `rgba(128, 128, 128, ${alpha})`
}

function layoutBase(pal: Palette, xTitle = '', yTitle = ''): Record<string, unknown> {
  const axis = (title: string) => ({
    title: { text: title, standoff: 8 }, gridcolor: withAlpha(pal.border, 0.7), linecolor: pal.border, zeroline: false,
    tickfont: { color: pal.muted, size: 11 }, automargin: true,
  })
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: pal.text, size: 12, family: 'inherit' },
    margin: { l: 52, r: 16, t: 14, b: 44 },
    xaxis: axis(xTitle),
    yaxis: axis(yTitle),
    legend: { orientation: 'h', y: -0.22, font: { color: pal.muted, size: 11 } },
    hoverlabel: { font: { family: 'inherit' } },
  }
}

export interface FitFigureInput {
  x: number[]
  y: number[]
  sigma?: number[]
  fit: FitResult | null
  xLabel: string
  yLabel: string
  /** Also draw the prediction interval. */
  prediction?: boolean
}

/** Scatter of the data with the fitted curve and its 95 % confidence band. */
export function fitFigure(i: FitFigureInput, pal: Palette = DEFAULT_PALETTE): Figure {
  const data: Trace[] = []
  const lo = Math.min(...i.x)
  const hi = Math.max(...i.x)
  const pad = (hi - lo || 1) * 0.03
  if (i.fit) {
    const c = curve(i.fit, lo - pad, hi + pad, 220)
    const xs = c.map((q) => q.x)
    if (i.prediction) {
      data.push({ type: 'scatter', mode: 'lines', x: xs, y: c.map((q) => q.phi), line: { width: 0 }, hoverinfo: 'skip', showlegend: false })
      data.push({
        type: 'scatter', mode: 'lines', x: xs, y: c.map((q) => q.plo), line: { width: 0 }, fill: 'tonexty', fillcolor: withAlpha(pal.link, 0.1),
        name: '95 % prediction', hoverinfo: 'skip',
      })
    }
    data.push({ type: 'scatter', mode: 'lines', x: xs, y: c.map((q) => q.hi), line: { width: 0 }, hoverinfo: 'skip', showlegend: false })
    data.push({
      type: 'scatter', mode: 'lines', x: xs, y: c.map((q) => q.lo), line: { width: 0 }, fill: 'tonexty', fillcolor: withAlpha(pal.link, 0.25),
      name: '95 % confidence', hoverinfo: 'skip',
    })
    data.push({ type: 'scatter', mode: 'lines', x: xs, y: c.map((q) => q.y), line: { color: pal.link, width: 2 }, name: i.fit.label })
  }
  data.push({
    type: 'scatter', mode: 'markers', x: i.x, y: i.y, name: 'data',
    marker: { color: pal.accent, size: 8, line: { color: pal.text, width: 0.5 } },
    ...(i.sigma ? { error_y: { type: 'data', array: i.sigma, color: pal.muted, thickness: 1, width: 3 } } : {}),
  })
  return { data, layout: { ...layoutBase(pal, i.xLabel, i.yLabel), showlegend: true } }
}

/** Residuals against x, with the ±2 s lines. */
export function residualFigure(x: number[], fit: FitResult, pal: Palette = DEFAULT_PALETTE): Figure {
  const s = fit.residualSd
  const lo = Math.min(...x)
  const hi = Math.max(...x)
  const line = (y: number, dash: string, color: string) => ({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: y, y1: y, line: { color, width: 1, dash } })
  return {
    data: [{
      type: 'scatter', mode: 'markers', x, y: fit.residuals, name: 'residual',
      marker: { color: pal.accent, size: 8, line: { color: pal.text, width: 0.5 } },
    }],
    layout: {
      ...layoutBase(pal, 'x', 'residual (y − fit)'),
      showlegend: false,
      shapes: [line(0, 'solid', pal.muted), ...(Number.isFinite(s) && s > 0 ? [line(2 * s, 'dot', pal.danger), line(-2 * s, 'dot', pal.danger)] : [])],
      xaxis: { ...(layoutBase(pal, 'x').xaxis as object), range: [lo - (hi - lo) * 0.04, hi + (hi - lo) * 0.04] },
    },
  }
}

/** Histogram of one column with the normal curve of the same mean and sd. */
export function histogramFigure(values: number[], label: string, pal: Palette = DEFAULT_PALETTE, bins?: number): Figure {
  const h = histogram(values, bins)
  const centers = h.counts.map((_, k) => (h.edges[k] + h.edges[k + 1]) / 2)
  const data: Trace[] = [{
    type: 'bar', x: centers, y: h.counts, width: h.edges.slice(1).map((e, k) => e - h.edges[k]), name: 'count',
    marker: { color: withAlpha(pal.accent, 0.75), line: { color: pal.accent, width: 1 } },
    hovertemplate: 'count %{y}<extra></extra>',
  }]
  const n = values.length
  const m = n ? mean(values) : 0
  const s = n > 1 ? sd(values) : 0
  if (s > 0) {
    const a = h.edges[0] - h.width
    const b = h.edges[h.edges.length - 1] + h.width
    const xs = Array.from({ length: 120 }, (_, k) => a + ((b - a) * k) / 119)
    data.push({
      type: 'scatter', mode: 'lines', x: xs, name: 'normal curve', line: { color: pal.link, width: 2 },
      y: xs.map((v) => n * h.width * Math.exp(-((v - m) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI))),
      hoverinfo: 'skip',
    })
  }
  return { data, layout: { ...layoutBase(pal, label, 'count'), bargap: 0.04, showlegend: s > 0 } }
}

/** Box plots (quartile box, median, mean ◆, whiskers at 1.5 × IQR, outliers as points). */
export function boxFigure(groups: { name: string; values: number[] }[], standardise: boolean, pal: Palette = DEFAULT_PALETTE): Figure {
  const data: Trace[] = groups.map((g) => {
    const m = mean(g.values)
    const s = sd(g.values) || 1
    return {
      type: 'box', name: g.name, y: standardise ? g.values.map((v) => (v - m) / s) : g.values, boxmean: true, boxpoints: 'outliers',
      marker: { color: pal.accent, outliercolor: pal.danger, size: 5 }, line: { color: pal.accent, width: 1.5 },
      fillcolor: withAlpha(pal.accent, 0.2),
    }
  })
  return { data, layout: { ...layoutBase(pal, '', standardise ? 'z-score' : 'value'), showlegend: false } }
}

/** Correlation heat-map, diverging around 0. */
export function heatmapFigure(m: CorrMatrix, pal: Palette = DEFAULT_PALETTE): Figure {
  const text = m.r.map((row) => row.map((v) => (Number.isFinite(v) ? v.toFixed(2) : '')))
  return {
    data: [{
      type: 'heatmap', x: m.names, y: m.names, z: m.r.map((row) => row.map((v) => (Number.isFinite(v) ? v : null))), zmin: -1, zmax: 1,
      colorscale: [[0, pal.danger], [0.5, pal.surface], [1, pal.accent]], text, texttemplate: '%{text}',
      textfont: { color: pal.text, size: 12 }, xgap: 2, ygap: 2, hovertemplate: '%{y} vs %{x}: r = %{z:.3f}<extra></extra>',
      colorbar: { tickfont: { color: pal.muted }, outlinewidth: 0, thickness: 10 },
    }],
    layout: {
      ...layoutBase(pal),
      xaxis: { ...(layoutBase(pal).xaxis as object), side: 'bottom', showgrid: false },
      yaxis: { ...(layoutBase(pal).yaxis as object), autorange: 'reversed', showgrid: false },
      margin: { l: 80, r: 10, t: 10, b: 70 },
      showlegend: false,
    },
  }
}
