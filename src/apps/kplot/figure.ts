// kPlot's figure model: the types shared by the SVG engine (plot.ts), the Plotly engine
// (plotly.ts) and the window, the palettes, themes and size presets, and the options a
// project file keeps.  Pure TypeScript (no React, no "@/" imports): Node tests it.

export type PlotType = 'xy' | 'bar' | 'stacked' | 'histogram' | 'box' | 'area'
/** Types only the interactive (Plotly) engine draws. The SVG engine draws them as 'xy'. */
export type PlotlyOnlyType = 'heatmap' | 'contour' | 'scatter3d' | 'surface' | 'violin' | 'matrix'
export type ChartType = PlotType | PlotlyOnlyType
export type Engine = 'plotly' | 'svg'
export type PlotStyle = 'line' | 'points' | 'both'
export type LineStyle = 'solid' | 'dashed' | 'dotted'
export type Marker = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'plus'
export type ScaleKind = 'linear' | 'log10' | 'ln'
export type NumberFormat = 'auto' | 'fixed' | 'sci'
export type LegendPos = 'auto' | 'none' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'outside-right' | 'outside-top'
export type ThemeName = 'white' | 'dark' | 'transparent'
export type PaletteName = 'publication' | 'okabe-ito' | 'greyscale' | 'kherve-green'
export type SizePreset = 'screen' | 'single' | 'onehalf' | 'double' | 'slide' | 'square' | 'custom'
export type FontFamily = 'sans' | 'serif' | 'mono'
export type Frame = 'box' | 'l'
export type TicksDir = 'out' | 'in'
export type ErrorMode = 'none' | 'column' | 'sd'
export type HistNorm = 'count' | 'density'

export const PLOT_TYPES: [ChartType, string][] = [
  ['xy', 'Scatter / line'],
  ['bar', 'Bar (grouped)'],
  ['stacked', 'Stacked bar'],
  ['histogram', 'Histogram'],
  ['box', 'Box plot'],
  ['area', 'Area'],
  ['heatmap', 'Heat map (matrix)'],
  ['contour', 'Contour (matrix)'],
  ['scatter3d', '3D scatter (x, y, z)'],
  ['surface', '3D surface (matrix)'],
  ['violin', 'Violin'],
  ['matrix', 'Scatter matrix'],
]
export const PLOTLY_ONLY: ChartType[] = ['heatmap', 'contour', 'scatter3d', 'surface', 'violin', 'matrix']
export const isPlotlyOnly = (t: ChartType): boolean => PLOTLY_ONLY.includes(t)
/** The type the SVG engine draws for a chart type. */
export const svgType = (t: ChartType): PlotType => (isPlotlyOnly(t) ? (t === 'violin' ? 'box' : 'xy') : (t as PlotType))

export const MARKERS: Marker[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus']

// ------------------------------------------------------------------ axes and series

export interface AxisOpt {
  /** '' = the column name. */
  label: string
  scale: ScaleKind
  /** null = automatic. */
  min: number | null
  max: number | null
  /** About how many major ticks. */
  ticks: number
  grid: boolean
  minorGrid: boolean
  invert: boolean
  format: NumberFormat
  decimals: number
}

export interface SeriesStyle {
  /** '' / undefined = the column name. */
  name?: string
  /** '' / undefined = the palette colour. */
  color?: string
  /** '' / undefined = the figure's style. */
  style?: PlotStyle | ''
  lineStyle?: LineStyle
  /** Line width in pt (0 / undefined = automatic). */
  width?: number
  marker?: Marker | ''
  /** Marker diameter in pt (0 / undefined = automatic). */
  size?: number
  /** 0–1 (fill and markers); undefined = automatic. */
  opacity?: number
  hidden?: boolean
  axis?: 'left' | 'right'
}

/** A series as the window keeps it: a column of the table. */
export interface SeriesOpt extends SeriesStyle {
  col: number
  errors: ErrorMode
  /** The column holding ± values when errors = 'column'. */
  errCol: number
}

/** A series as the engines draw it. */
export interface Series extends SeriesStyle {
  name: string
  x: number[]
  y: number[]
  /** ± values (same length as y). */
  err?: number[]
  /** 3D scatter: the z values (same length as y). */
  z?: number[]
}

export interface FitSpec {
  /** Index into the series. */
  series: number
  /** 1 = straight line. */
  degree: number
  /** Print the equation and R² on the plot. */
  label: boolean
  color?: string
}
export interface RefLine {
  axis: 'x' | 'y' | 'y2'
  value: number
  color?: string
  lineStyle?: LineStyle
  width?: number
  label?: string
}
export interface Note {
  x: number
  y: number
  text: string
  color?: string
  size?: number
}
export interface Region {
  axis: 'x' | 'y'
  from: number
  to: number
  color?: string
  opacity?: number
  label?: string
}

// ------------------------------------------------------------------ the whole style

export interface Style {
  type: ChartType
  title: string
  /** The style of xy series that do not set their own. */
  style: PlotStyle
  x: AxisOpt
  y: AxisOpt
  y2: AxisOpt
  legend: LegendPos
  sizePreset: SizePreset
  /** Millimetres. */
  width: number
  height: number
  fontFamily: FontFamily
  /** Points. */
  fontSize: number
  /** Axis line width in pt (0 = automatic). */
  lineWidth: number
  theme: ThemeName
  palette: PaletteName
  frame: Frame
  ticksDir: TicksDir
  /** Histogram: number of bins (0 = automatic). */
  bins: number
  histNorm: HistNorm
  fits: FitSpec[]
  lines: RefLine[]
  notes: Note[]
  regions: Region[]
}

export const defaultAxis = (): AxisOpt => ({
  label: '', scale: 'linear', min: null, max: null, ticks: 6, grid: false, minorGrid: false, invert: false, format: 'auto', decimals: 2,
})

export const SIZE_PRESETS: Record<Exclude<SizePreset, 'custom'>, { label: string; w: number; h: number; font: number }> = {
  screen: { label: 'Screen (170 × 112 mm)', w: 170, h: 112, font: 10 },
  single: { label: 'Single column (86 mm)', w: 86, h: 65, font: 8 },
  onehalf: { label: '1.5 column (120 mm)', w: 120, h: 85, font: 9 },
  double: { label: 'Double column (178 mm)', w: 178, h: 110, font: 10 },
  slide: { label: 'Slide 16:9 (254 × 143 mm)', w: 254, h: 143, font: 16 },
  square: { label: 'Square (100 mm)', w: 100, h: 100, font: 10 },
}

export const defaultStyle = (): Style => ({
  type: 'xy',
  title: '',
  style: 'both',
  x: defaultAxis(),
  y: defaultAxis(),
  y2: defaultAxis(),
  legend: 'auto',
  sizePreset: 'screen',
  width: 170,
  height: 112,
  fontFamily: 'sans',
  fontSize: 10,
  lineWidth: 0,
  theme: 'white',
  palette: 'publication',
  frame: 'box',
  ticksDir: 'out',
  bins: 0,
  histNorm: 'count',
  fits: [],
  lines: [],
  notes: [],
  regions: [],
})

// ------------------------------------------------------------------ palettes and themes

export const PALETTES: Record<PaletteName, { label: string; colors: string[] }> = {
  publication: { label: 'Publication', colors: ['#1f4e9c', '#c0392b', '#1e8449', '#8e44ad', '#d68910', '#17a2b8', '#555555', '#b8336a'] },
  'okabe-ito': { label: 'Colour-blind safe (Okabe–Ito)', colors: ['#0072B2', '#D55E00', '#009E73', '#E69F00', '#56B4E9', '#CC79A7', '#F0E442', '#000000'] },
  greyscale: { label: 'Greyscale', colors: ['#000000', '#4d4d4d', '#808080', '#a6a6a6', '#262626', '#666666', '#8c8c8c', '#bfbfbf'] },
  'kherve-green': { label: 'Kherve Green', colors: ['#15803d', '#0f766e', '#65a30d', '#0e7490', '#166534', '#84cc16', '#115e59', '#3f6212'] },
}
export const COLORS = PALETTES.publication.colors

export interface ThemeColors {
  /** null = transparent. */
  bg: string | null
  fg: string
  grid: string
  minorGrid: string
  /** A page colour to separate touching shapes (bars, boxes). */
  page: string
}
export const THEMES: Record<ThemeName, ThemeColors> = {
  white: { bg: '#ffffff', fg: '#111111', grid: '#e3e3e3', minorGrid: '#f0f0f0', page: '#ffffff' },
  dark: { bg: '#16181c', fg: '#e8e8e8', grid: '#3a3d42', minorGrid: '#2a2d31', page: '#16181c' },
  transparent: { bg: null, fg: '#111111', grid: '#e3e3e3', minorGrid: '#f0f0f0', page: '#ffffff' },
}

function rgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (c: number[]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
const luminance = (c: number[]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255

/** The palette's colours for a theme: on a dark page dark colours are lightened (greys are inverted). */
export function themedPalette(name: PaletteName, theme: ThemeName): string[] {
  const colors = (PALETTES[name] ?? PALETTES.publication).colors
  if (theme !== 'dark') return colors
  return colors.map((hex) => {
    const c = rgb(hex)
    if (!c) return hex
    if (name === 'greyscale') return toHex(c.map((v) => 255 - v))
    if (luminance(c) >= 0.42) return hex
    return toHex(c.map((v) => v + (255 - v) * 0.5))
  })
}

/** Colour of series `i` (explicit colour first). */
export function seriesColor(s: SeriesStyle, i: number, palette: PaletteName, theme: ThemeName): string {
  if (s.color) return s.color
  const p = themedPalette(palette, theme)
  return p[i % p.length]
}

export const FONT_STACKS: Record<FontFamily, string> = {
  sans: 'Helvetica, Arial, sans-serif',
  serif: '"Times New Roman", Times, serif',
  mono: '"Courier New", Courier, monospace',
}

/** Figure size in points (1/72 in) from millimetres. */
export const mmToPt = (mm: number): number => (mm * 72) / 25.4

export function isColor(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)
}

// ------------------------------------------------------------------ what the engines draw

/** Everything an engine needs: the style (every field optional) and the data. */
export interface FigureInput extends Partial<Omit<Style, 'x' | 'y' | 'y2'>> {
  x?: Partial<AxisOpt>
  y?: Partial<AxisOpt>
  y2?: Partial<AxisOpt>
  series: Series[]
  /** Bar charts: the label of each category (default 1, 2, 3…). */
  categories?: string[]
  /** Axis labels already resolved (automatic names filled in); they win over x.label… */
  xLabel?: string
  yLabel?: string
  y2Label?: string
  /** A matrix (heat map, contour, surface): rows × columns, with the labels of each. */
  matrix?: { z: number[][]; xs: (number | string)[]; ys: (number | string)[] }
}

export interface Figure extends Style {
  series: Series[]
  categories?: string[]
  xLabel: string
  yLabel: string
  y2Label: string
  matrix?: FigureInput['matrix']
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const pick = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)

function mergeAxis(base: AxisOpt, a?: Partial<AxisOpt>): AxisOpt {
  if (!a) return base
  return {
    label: typeof a.label === 'string' ? a.label : base.label,
    scale: pick(a.scale, ['linear', 'log10', 'ln'], base.scale),
    min: a.min === undefined ? base.min : a.min === null || !Number.isFinite(a.min) ? null : a.min,
    max: a.max === undefined ? base.max : a.max === null || !Number.isFinite(a.max) ? null : a.max,
    ticks: Math.min(20, Math.max(2, Math.round(num(a.ticks, base.ticks)))),
    grid: typeof a.grid === 'boolean' ? a.grid : base.grid,
    minorGrid: typeof a.minorGrid === 'boolean' ? a.minorGrid : base.minorGrid,
    invert: typeof a.invert === 'boolean' ? a.invert : base.invert,
    format: pick(a.format, ['auto', 'fixed', 'sci'], base.format),
    decimals: Math.min(10, Math.max(0, Math.round(num(a.decimals, base.decimals)))),
  }
}

/** Fill every style field of an input (and sanity-check the values). */
export function resolveFigure(input: FigureInput): Figure {
  const d = defaultStyle()
  const type = pick(input.type, PLOT_TYPES.map((t) => t[0]), d.type)
  const x = mergeAxis(d.x, input.x)
  const y = mergeAxis(d.y, input.y)
  const y2 = mergeAxis(d.y2, input.y2)
  return {
    type,
    title: input.title ?? d.title,
    style: pick(input.style, ['line', 'points', 'both'], d.style),
    x, y, y2,
    legend: pick(input.legend, ['auto', 'none', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'outside-right', 'outside-top'], d.legend),
    sizePreset: pick(input.sizePreset, ['screen', 'single', 'onehalf', 'double', 'slide', 'square', 'custom'], d.sizePreset),
    width: Math.min(1000, Math.max(20, num(input.width, d.width))),
    height: Math.min(1000, Math.max(20, num(input.height, d.height))),
    fontFamily: pick(input.fontFamily, ['sans', 'serif', 'mono'], d.fontFamily),
    fontSize: Math.min(40, Math.max(4, num(input.fontSize, d.fontSize))),
    lineWidth: Math.max(0, num(input.lineWidth, d.lineWidth)),
    theme: pick(input.theme, ['white', 'dark', 'transparent'], d.theme),
    palette: pick(input.palette, ['publication', 'okabe-ito', 'greyscale', 'kherve-green'], d.palette),
    frame: pick(input.frame, ['box', 'l'], d.frame),
    ticksDir: pick(input.ticksDir, ['out', 'in'], d.ticksDir),
    bins: Math.min(200, Math.max(0, Math.round(num(input.bins, d.bins)))),
    histNorm: pick(input.histNorm, ['count', 'density'], d.histNorm),
    fits: input.fits ?? [],
    lines: input.lines ?? [],
    notes: input.notes ?? [],
    regions: input.regions ?? [],
    series: input.series,
    categories: input.categories,
    xLabel: input.xLabel ?? x.label,
    yLabel: input.yLabel ?? y.label,
    y2Label: input.y2Label ?? y2.label,
    matrix: input.matrix,
  }
}

// ------------------------------------------------------------------ the window's options (kept in a .kplot file)

export interface Options extends Style {
  engine: Engine
  /** The x column. */
  xi: number
  series: SeriesOpt[]
}

export const newSeriesOpt = (col: number): SeriesOpt => ({ col, errors: 'none', errCol: -1 })

export const defaultOptions = (): Options => ({ ...defaultStyle(), engine: 'plotly', xi: 0, series: [newSeriesOpt(1)] })

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** The object without its undefined fields (so it compares and serialises the same). */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

function cleanSeries(v: unknown): SeriesOpt | null {
  const o = obj(v)
  const col = Number(o.col)
  if (!Number.isInteger(col) || col < 0) return null
  const s: SeriesOpt = {
    col,
    errors: pick(o.errors, ['none', 'column', 'sd'], 'none'),
    errCol: Number.isInteger(o.errCol) ? (o.errCol as number) : -1,
  }
  if (typeof o.name === 'string') s.name = o.name
  if (isColor(o.color)) s.color = o.color
  if (o.style === 'line' || o.style === 'points' || o.style === 'both') s.style = o.style
  if (o.lineStyle === 'dashed' || o.lineStyle === 'dotted' || o.lineStyle === 'solid') s.lineStyle = o.lineStyle
  if (typeof o.width === 'number' && o.width >= 0) s.width = o.width
  if (MARKERS.includes(o.marker as Marker)) s.marker = o.marker as Marker
  if (typeof o.size === 'number' && o.size >= 0) s.size = o.size
  if (typeof o.opacity === 'number') s.opacity = Math.min(1, Math.max(0, o.opacity))
  if (o.hidden === true) s.hidden = true
  if (o.axis === 'right') s.axis = 'right'
  return s
}

/** Options from untrusted JSON (a project file, an AI tool): unknown or invalid fields fall back to the defaults. */
export function cleanOptions(raw: unknown): Options {
  const o = obj(raw)
  const base = defaultOptions()
  const f = resolveFigure({ ...(o as Partial<Style>), series: [] })
  const { series: _s, categories: _c, xLabel: _xl, yLabel: _yl, y2Label: _y2l, matrix: _m, ...style } = f
  void _s; void _c; void _xl; void _yl; void _y2l; void _m
  const list = Array.isArray(o.series) ? o.series.map(cleanSeries).filter((s): s is SeriesOpt => s !== null) : base.series
  const fits = (Array.isArray(o.fits) ? o.fits : []).map(obj).filter((q) => Number.isInteger(q.series)).map((q): FitSpec => defined({
    series: q.series as number, degree: Math.min(6, Math.max(1, Math.round(num(q.degree, 1)))), label: q.label !== false, color: isColor(q.color) ? q.color : undefined,
  }))
  const lines = (Array.isArray(o.lines) ? o.lines : []).map(obj).filter((q) => Number.isFinite(q.value)).map((q): RefLine => defined({
    axis: q.axis === 'x' || q.axis === 'y2' ? q.axis : 'y', value: q.value as number, color: isColor(q.color) ? q.color : undefined,
    lineStyle: pick<LineStyle>(q.lineStyle, ['solid', 'dashed', 'dotted'], 'dashed'), width: typeof q.width === 'number' ? q.width : undefined, label: typeof q.label === 'string' ? q.label : undefined,
  }))
  const notes = (Array.isArray(o.notes) ? o.notes : []).map(obj).filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y) && typeof q.text === 'string').map((q): Note => defined({
    x: q.x as number, y: q.y as number, text: q.text as string, color: isColor(q.color) ? q.color : undefined, size: typeof q.size === 'number' ? q.size : undefined,
  }))
  const regions = (Array.isArray(o.regions) ? o.regions : []).map(obj).filter((q) => Number.isFinite(q.from) && Number.isFinite(q.to)).map((q): Region => defined({
    axis: q.axis === 'y' ? 'y' : 'x', from: q.from as number, to: q.to as number, color: isColor(q.color) ? q.color : undefined,
    opacity: typeof q.opacity === 'number' ? q.opacity : undefined, label: typeof q.label === 'string' ? q.label : undefined,
  }))
  return {
    ...style,
    fits, lines, notes, regions,
    engine: o.engine === 'svg' ? 'svg' : 'plotly',
    xi: Number.isInteger(o.xi) && (o.xi as number) >= 0 ? (o.xi as number) : 0,
    series: list,
  }
}
