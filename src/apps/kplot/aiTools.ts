// AI tools of kPlot (the manifest is src/os/ai/manifests/kplot.ts).

import type { useAppTools } from '@/os/ai/appTools'
import { buildFigure, type Table } from './data'
import { equationText, polyFit } from './fit'
import { PLOT_TYPES, SIZE_PRESETS, newSeriesOpt, type AxisOpt, type ChartType, type Engine, type LegendPos, type Options, type PaletteName, type PlotStyle, type ScaleKind, type SizePreset, type ThemeName } from './figure'

type Tools = Parameters<typeof useAppTools>[1]

interface Hooks {
  setData(text: string): { rows: number; columns: string[] }
  table(): Table
  options(): Options
  setOptions(fn: (o: Options) => Options): void
  /** Save the publication SVG into Documents/kPlot. */
  saveSvg(name?: string): Promise<string>
  exportImage(format: 'png' | 'svg' | 'plotly_svg' | 'clipboard', scale: number, name?: string, engine?: Engine): Promise<{ path?: string; copied?: boolean }>
  svgText(): string
}

const STYLES: PlotStyle[] = ['both', 'line', 'points']
const LEGENDS: LegendPos[] = ['auto', 'none', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'outside-right', 'outside-top']

/** A column by its header, or its number from 1. */
function column(headers: string[], key: unknown): number {
  const s = String(key ?? '').trim()
  const byName = headers.findIndex((h) => h.toLowerCase() === s.toLowerCase())
  if (byName >= 0) return byName
  const n = Number(s)
  if (Number.isInteger(n) && n >= 1 && n <= headers.length) return n - 1
  throw new Error(`There is no column "${s}" (the columns are: ${headers.join(', ')}).`)
}

function oneOf<T extends string>(v: unknown, list: readonly T[], what: string): T {
  if (!list.includes(v as T)) throw new Error(`${what} is one of: ${list.join(', ')}.`)
  return v as T
}

/** A limit: a number, or "auto" / empty for automatic. */
function limit(v: unknown): number | null {
  if (v === null || v === '' || String(v).toLowerCase() === 'auto') return null
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`"${String(v)}" is not a number (use a number or "auto").`)
  return n
}

export function kplotTools(h: Hooks): Tools {
  return {
    set_data: async (a) => {
      const text = String(a.text ?? '')
      const r = h.setData(text)
      return { ...r, note: 'The first column is x and the numeric columns are plotted; change that with set_options.' }
    },
    set_options: async (a) => {
      const headers = h.table().headers
      const patch: Partial<Options> = {}
      let x: number | undefined
      if (a.x !== undefined) x = column(headers, a.x)
      const cols = a.y !== undefined ? String(a.y).split(',').map((s) => s.trim()).filter(Boolean).map((k) => column(headers, k)) : undefined
      if (a.title !== undefined) patch.title = String(a.title)
      if (a.style !== undefined) patch.style = oneOf<PlotStyle>(a.style, STYLES, 'style')
      h.setOptions((o) => {
        const xi = x ?? o.xi
        const series = cols ? cols.filter((c, i) => cols.indexOf(c) === i).map((c) => o.series.find((s) => s.col === c) ?? newSeriesOpt(c)) : o.series.filter((s) => s.col !== xi)
        return {
          ...o, ...patch, xi, series,
          x: a.x_label !== undefined ? { ...o.x, label: String(a.x_label) } : o.x,
          y: a.y_label !== undefined ? { ...o.y, label: String(a.y_label) } : o.y,
        }
      })
      return { shown: true, note: 'The plot in the window is updated.' }
    },
    set_figure: async (a) => {
      const patch: Partial<Options> = {}
      if (a.type !== undefined) patch.type = oneOf<ChartType>(a.type, PLOT_TYPES.map((t) => t[0]), 'type')
      if (a.engine !== undefined) patch.engine = oneOf<Engine>(a.engine, ['plotly', 'svg'], 'engine')
      if (a.legend !== undefined) patch.legend = oneOf<LegendPos>(a.legend, LEGENDS, 'legend')
      if (a.theme !== undefined) patch.theme = oneOf<ThemeName>(a.theme, ['white', 'dark', 'transparent'], 'theme')
      if (a.palette !== undefined) patch.palette = oneOf<PaletteName>(a.palette, ['publication', 'okabe-ito', 'greyscale', 'kherve-green'], 'palette')
      if (a.size !== undefined) {
        const p = oneOf<Exclude<SizePreset, 'custom'>>(a.size, Object.keys(SIZE_PRESETS) as Exclude<SizePreset, 'custom'>[], 'size')
        const s = SIZE_PRESETS[p]
        Object.assign(patch, { sizePreset: p, width: s.w, height: s.h, fontSize: s.font })
      }
      h.setOptions((o) => ({ ...o, ...patch }))
      return { shown: true, note: 'The plot in the window is updated.' }
    },
    set_axis: async (a) => {
      const which = oneOf<'x' | 'y' | 'y2'>(a.axis, ['x', 'y', 'y2'], 'axis')
      const p: Partial<AxisOpt> = {}
      if (a.scale !== undefined) p.scale = oneOf<ScaleKind>(a.scale, ['linear', 'log10', 'ln'], 'scale')
      if (a.min !== undefined) p.min = limit(a.min)
      if (a.max !== undefined) p.max = limit(a.max)
      if (a.invert !== undefined) p.invert = !!a.invert
      if (a.grid !== undefined) p.grid = !!a.grid
      h.setOptions((o) => ({ ...o, [which]: { ...o[which], ...p } }))
      return { shown: true, note: which === 'y2' ? 'The right y axis shows series set to the right axis.' : 'The plot in the window is updated.' }
    },
    add_overlay: async (a) => {
      const kind = oneOf<'fit' | 'line' | 'note' | 'region' | 'clear'>(a.kind, ['fit', 'line', 'note', 'region', 'clear'], 'kind')
      const text = a.text === undefined ? undefined : String(a.text)
      if (kind === 'clear') {
        h.setOptions((o) => ({ ...o, fits: [], lines: [], notes: [], regions: [] }))
        return { cleared: true }
      }
      if (kind === 'fit') {
        const table = h.table()
        const col = column(table.headers, a.target)
        const degree = Math.min(6, Math.max(1, Math.round(Number(a.degree ?? 1)) || 1))
        let result: Record<string, unknown> = {}
        h.setOptions((o) => {
          let idx = o.series.findIndex((s) => s.col === col)
          const series = idx >= 0 ? o.series : [...o.series, newSeriesOpt(col)]
          if (idx < 0) idx = series.length - 1
          const fig = buildFigure(table, { ...o, series })
          const s = fig.series[idx]
          const f = s ? polyFit(s.x, s.y, degree) : null
          result = f ? { coefficients: f.coef, r2: f.r2, equation: equationText(f.coef) } : { error: 'Not enough points for this degree.' }
          return { ...o, series, fits: [...o.fits.filter((q) => q.series !== idx), { series: idx, degree, label: true }] }
        })
        return { ...result, series: table.headers[col], degree, note: 'The fit line, its equation and R² are on the plot.' }
      }
      const value = Number(a.value)
      if (!Number.isFinite(value)) throw new Error('value must be a number.')
      if (kind === 'line') {
        const axis = oneOf<'x' | 'y' | 'y2'>(a.target ?? 'y', ['x', 'y', 'y2'], 'target (the axis)')
        h.setOptions((o) => ({ ...o, lines: [...o.lines, { axis, value, label: text, lineStyle: 'dashed' }] }))
        return { added: 'reference line', axis, value }
      }
      if (kind === 'note') {
        const y = Number(a.to)
        if (!Number.isFinite(y)) throw new Error('For a note, value is x and to is y (both numbers).')
        h.setOptions((o) => ({ ...o, notes: [...o.notes, { x: value, y, text: text ?? '' }] }))
        return { added: 'note' }
      }
      const to = Number(a.to)
      if (!Number.isFinite(to)) throw new Error('For a region, value is where it starts and to is where it ends (numbers).')
      const axis = oneOf<'x' | 'y'>(a.target ?? 'x', ['x', 'y'], 'target (the axis)')
      h.setOptions((o) => ({ ...o, regions: [...o.regions, { axis, from: value, to, label: text }] }))
      return { added: 'shaded region', axis }
    },
    save: async (a) => {
      const p = await h.saveSvg(a.name === undefined ? undefined : String(a.name))
      return { path: p, note: 'An SVG file: open it in Viewer, KherveWord or KherveSlide.' }
    },
    export: async (a) => {
      const format = oneOf<'png' | 'svg' | 'plotly_svg' | 'clipboard' | 'svg_text'>(a.format, ['png', 'svg', 'plotly_svg', 'clipboard', 'svg_text'], 'format')
      if (format === 'svg_text') {
        const svg = h.svgText()
        return svg.length > 60000 ? { svg: svg.slice(0, 60000), truncated: true } : { svg }
      }
      const scale = Math.min(4, Math.max(1, Math.round(Number(a.scale ?? 2)) || 2))
      const engine = a.engine === undefined ? undefined : oneOf<Engine>(a.engine, ['plotly', 'svg'], 'engine')
      const r = await h.exportImage(format, scale, a.name === undefined ? undefined : String(a.name), engine)
      return { ...r, format, ...(format === 'png' ? { scale } : {}) }
    },
  }
}
