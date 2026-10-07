// The parts of matplotlib the desktop KherveFitting's plot relies on, so the
// web plot puts its ticks, labels and ×10ⁿ factors where the desktop does:
// MaxNLocator (the default AutoLocator), AutoMinorLocator, ScalarFormatter
// (offset, order of magnitude, number of decimals) and the axis tick space.
// Plain functions, no DOM: Node tests load this file.

/** Screen pixels per typographic point: wx's FigureCanvas draws the figure at 100 dpi. */
export const PT = 100 / 72

const STEPS = [1, 2, 2.5, 5, 10]
/** MaxNLocator._staircase(steps) */
const EXTENDED = [...STEPS.slice(0, -1).map((s) => 0.1 * s), ...STEPS, 10 * STEPS[1]]

function scaleRange(vmin: number, vmax: number, n: number, threshold = 100) {
  const dv = Math.abs(vmax - vmin)
  const meanv = (vmax + vmin) / 2
  let offset = 0
  if (!(Math.abs(meanv) / dv < threshold)) offset = Math.sign(meanv) * 10 ** Math.floor(Math.log10(Math.abs(meanv)))
  const scale = 10 ** Math.floor(Math.log10(dv / n))
  return { scale, offset }
}

/** Python's divmod for floats. */
function divmod(x: number, y: number): [number, number] {
  const d = Math.floor(x / y)
  return [d, x - d * y]
}

function edge(step: number, offset: number) {
  const closeto = (ms: number, e: number) => {
    let tol = 1e-10
    if (offset > 0) {
      const digits = Math.log10(offset / step)
      tol = Math.min(0.4999, Math.max(1e-10, 10 ** (digits - 12)))
    }
    return Math.abs(ms - e) < tol
  }
  return {
    le(x: number) {
      const [d, m] = divmod(x, step)
      return closeto(m / step, 1) ? d + 1 : d
    },
    ge(x: number) {
      const [d, m] = divmod(x, step)
      return closeto(m / step, 0) ? d : d + 1
    },
  }
}

/** matplotlib.ticker.MaxNLocator(nbins, steps=[1, 2, 2.5, 5, 10])._raw_ticks */
export function maxNLocator(vmin: number, vmax: number, nbins: number, minNTicks = 2): number[] {
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) return []
  if (vmax < vmin) [vmin, vmax] = [vmax, vmin]
  if (vmax === vmin) {
    // nonsingular(): expand a zero-width interval
    const d = vmin === 0 ? 1 : Math.abs(vmin) * 0.001
    vmin -= d
    vmax += d
  }
  const { scale, offset } = scaleRange(vmin, vmax, nbins)
  const lo = vmin - offset
  const hi = vmax - offset
  const steps = EXTENDED.map((s) => s * scale)
  const raw = (hi - lo) / nbins
  let istep = steps.findIndex((s) => s >= raw)
  if (istep < 0) istep = steps.length - 1
  let ticks: number[] = []
  for (let k = istep; k >= 0; k--) {
    const step = steps[k]
    const best = Math.floor(lo / step) * step
    const e = edge(step, offset)
    const low = e.le(lo - best)
    const high = e.ge(hi - best)
    ticks = []
    for (let i = low; i <= high; i++) ticks.push(i * step + best)
    const n = ticks.filter((t) => t <= hi && t >= lo).length
    if (n >= minNTicks) break
  }
  return ticks.map((t) => t + offset)
}

/** Axis.get_tick_space(): how many labels fit (x: 3 font sizes each, y: 2). */
export function tickSpace(lengthPx: number, labelSizePt: number, axis: 'x' | 'y'): number {
  const lengthPt = lengthPx / PT
  const size = labelSizePt * (axis === 'x' ? 3 : 2)
  return Math.floor(lengthPt / size)
}

/** The AutoLocator ticks of an axis `lengthPx` long (nbins = tick space clipped to 1…9). */
export function autoTicks(vmin: number, vmax: number, lengthPx: number, labelSizePt: number, axis: 'x' | 'y'): number[] {
  const nbins = Math.max(1, Math.min(9, tickSpace(lengthPx, labelSizePt, axis)))
  return maxNLocator(vmin, vmax, nbins)
}

/** AutoMinorLocator(n): n-1 minor ticks between majors, majors removed. */
export function minorTicks(majors: number[], vmin: number, vmax: number, n: number): number[] {
  if (majors.length < 2 || n < 2) return []
  if (vmax < vmin) [vmin, vmax] = [vmax, vmin]
  const majorStep = majors[1] - majors[0]
  const minorStep = majorStep / n
  const t0 = majors[0]
  const tmin = Math.round((vmin - t0) / minorStep)
  const tmax = Math.round((vmax - t0) / minorStep) + 1
  const out: number[] = []
  for (let i = tmin; i < tmax; i++) {
    if (i % n === 0) continue
    const v = i * minorStep + t0
    if (v >= vmin - minorStep * 1e-9 && v <= vmax + minorStep * 1e-9) out.push(v)
  }
  return out
}

export interface TickFormat {
  /** Tick label text, one per tick. */
  labels: string[]
  /** Power of ten taken out (the "×10ⁿ" text), 0 for none. */
  order: number
  /** Value taken out (the "+1.234e3" text), 0 for none. */
  offset: number
}

const MINUS = '−'
const withMinus = (s: string) => (s.startsWith('-') ? MINUS + s.slice(1) : s)

/**
 * matplotlib.ticker.ScalarFormatter(useMathText=True) on these ticks.
 * `sci` = ticklabel_format(style='sci', scilimits=(0, 0)), as the desktop
 * sets on the intensity axis; otherwise the default limits (-5, 6).
 */
export function formatTicks(ticks: number[], vmin: number, vmax: number, sci: boolean): TickFormat {
  if (vmax < vmin) [vmin, vmax] = [vmax, vmin]
  const visible = ticks.filter((t) => t >= vmin && t <= vmax)
  // _compute_offset (offset_threshold 4)
  let offset = 0
  if (visible.length) {
    const lmin = Math.min(...visible)
    const lmax = Math.max(...visible)
    if (!(lmin === lmax || (lmin <= 0 && 0 <= lmax))) {
      const [absMin, absMax] = [Math.abs(lmin), Math.abs(lmax)].sort((a, b) => a - b)
      const sign = Math.sign(lmin) || 1
      const oomMax = Math.ceil(Math.log10(absMax))
      let oom = oomMax
      while (Math.floor(absMin / 10 ** oom) === Math.floor(absMax / 10 ** oom) && oom > -30) oom--
      oom += 1
      if ((absMax - absMin) / 10 ** oom <= 1e-2) {
        oom = oomMax
        while (!(absMax - absMin >= 10 ** oom) && oom > -30) oom--
        oom += 1
      }
      offset = Math.floor(absMax / 10 ** oom) >= 10 ** 3 ? sign * Math.floor(absMax / 10 ** oom) * 10 ** oom : 0
    }
  }
  // _compute_order_of_magnitude
  let order = 0
  if (visible.length) {
    const abs = visible.map(Math.abs)
    let oom: number
    if (offset) oom = Math.floor(Math.log10(vmax - vmin))
    else {
      const val = Math.max(...abs)
      oom = val === 0 ? 0 : Math.floor(Math.log10(val))
    }
    const [lo, hi] = sci ? [0, 0] : [-5, 6]
    if (oom <= lo) order = oom
    else if (oom >= hi) order = oom
  }
  // _set_format
  const src = ticks.length < 2 ? [...ticks, vmin, vmax] : ticks
  const locs = src.map((t) => (t - offset) / 10 ** order)
  let range = locs.length ? Math.max(...locs) - Math.min(...locs) : 0
  if (range === 0) range = Math.max(0, ...locs.map(Math.abs))
  if (range === 0) range = 1
  const rangeOom = Math.floor(Math.log10(range))
  let sig = Math.max(0, 3 - rangeOom)
  const thresh = 1e-3 * 10 ** rangeOom
  while (sig >= 0) {
    const s = sig
    const err = Math.max(...locs.map((v) => Math.abs(v - roundTo(v, s))))
    if (err < thresh) sig -= 1
    else break
  }
  sig += 1
  const labels = ticks.map((t) => {
    let v = (t - offset) / 10 ** order
    if (Math.abs(v) < 10 ** -(sig + 1)) v = 0
    return withMinus(v.toFixed(sig))
  })
  return { labels, order, offset }
}

function roundTo(v: number, decimals: number) {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

/** The desktop's core-level title: "Ni2p" → "Ni 2p", "Survey2" → "Survey" (PlotManager.format_sheet_name). */
export function formatSheetName(sheet: string): string {
  const s = /^(Survey|SURVEY|survey|Wide|WIDE|wide)(\d+)/.exec(sheet)
  if (s) return s[1].charAt(0).toUpperCase() + s[1].slice(1).toLowerCase()
  const m = /^([A-Z][a-z]*)(\d+[spdfg])/.exec(sheet)
  return m ? `${m[1]} ${m[2]}` : sheet
}

/** "Sr3d1" → "Sr3d" (PlotManager.extract_core_level_name). */
export function coreLevelOf(sheet: string): string | null {
  const m = /^([A-Z][a-z]?\d+[spdf])/.exec(sheet)
  return m ? m[1] : null
}

/** A legend label without its core level when it is the plotted one (make_compact_legend_label). */
export function compactLabel(label: string, core: string | null): string {
  if (!core) return label
  const words = label.split(/\s+/).filter(Boolean)
  if (core.endsWith('s')) {
    if (words.length >= 2 && words[0] === core) return words.slice(1).join(' ')
    return label
  }
  if ('pdf'.includes(core.slice(-1))) {
    const esc = core.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`^${esc}(?:\\d+/\\d+|\\$_\\{[\\d/]+\\}\\$)\\s+(.+)$`).exec(label)
    if (m) return m[1]
    if (words.length >= 2 && words[0] === core) return words.slice(1).join(' ')
  }
  return label
}

/** Legend text: "Sr3d5/2 p1" → mathtext "Sr3d$_{5/2}$ p1" (re.sub(r'(\d+/\d+)', r'$_{\1}$')). */
export function mathLabel(label: string): string {
  return label.replace(/(\d+\/\d+)/g, '$_{$1}$')
}

/** Pieces of a mathtext label: plain text and subscripts. */
export function mathPieces(text: string): { text: string; sub: boolean }[] {
  const out: { text: string; sub: boolean }[] = []
  const re = /\$_\{([^}]*)\}\$/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), sub: false })
    out.push({ text: m[1], sub: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), sub: false })
  return out
}

/**
 * The peaks the legend lists (update_legend, legend_visible = 2: "peaks
 * only"): labels of two or more words, shown without the core level.
 */
export function legendPeaks(labels: string[], sheet: string): { index: number; text: string }[] {
  const core = coreLevelOf(sheet)
  const out: { index: number; text: string }[] = []
  labels.forEach((label, index) => {
    const formatted = mathLabel(label)
    const clean = formatted.replace(/\$.*?\$/g, '')
    const words = clean.split(/\s+/).filter(Boolean)
    if (clean.trim().split(/\s+/).length > 1 && words[1]) out.push({ index, text: compactLabel(formatted, core) })
  })
  return out
}

/** Two adjacent peaks forming a spin-orbit doublet (PlotManager.is_part_of_doublet). */
export function isDoublet(current: string, next: string): boolean {
  const a = current.split(/\s+/).filter(Boolean)
  const b = next.split(/\s+/).filter(Boolean)
  if (!a.length || !b.length) return false
  const core = (s: string) => /^([A-Za-z]+\d+[spdf])/.exec(s)?.[1] ?? s
  const ca = core(a[0])
  if (ca !== core(b[0])) return false
  const orb = /\d([spdf])/.exec(ca)?.[1]
  const has = (parts: string[], c: string) => parts.some((p) => p.includes(c))
  if (orb === 'p') return has(a, '3/2') && has(b, '1/2')
  if (orb === 'd') return has(a, '5/2') && has(b, '3/2')
  if (orb === 'f') return has(a, '7/2') && has(b, '5/2')
  return false
}

/** Colour index and alpha of each peak: a doublet's second peak takes the first one's colour (clear_and_replot). */
export function peakColours(labels: string[], palette: string[], alpha: number): { colour: string; alpha: number; styleOf: number }[] {
  const doublets: number[] = []
  for (let i = 0; i < labels.length - 1; i++) if (isDoublet(labels[i], labels[i + 1])) doublets.push(i, i + 1)
  return labels.map((_, i) => {
    const k = doublets.indexOf(i)
    if (k >= 0 && k % 2 === 1) return { colour: palette[(i - 1) % palette.length], alpha: alpha * 0.99, styleOf: i - 1 }
    return { colour: palette[i % palette.length], alpha, styleOf: i }
  })
}

/** The desktop's factory plot style (default_config.json). */
export const PLOT_STYLE = {
  scatterSize: 3,
  scatterColor: '#000000',
  backgroundColor: '#804000',
  backgroundAlpha: 0.8,
  envelopeColor: '#000000',
  envelopeAlpha: 0.7,
  residualColor: '#0FF0D5',
  residualAlpha: 0.4,
  peakColors: [
    '#0080C0', '#FF0080', '#FF8000', '#8080C0', '#FF0000', '#00FFFF', '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#C0C0C0',
    '#808080', '#9B30FF',
  ],
  peakAlpha: 0.7,
  peakLineColor: 'black',
  peakLineAlpha: 0.4,
  hatchDensity: 3,
  font: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
  axisTitleSize: 11,
  axisNumberSize: 11,
  xSublines: 4,
  ySublines: 1,
  legendFontSize: 10,
  coreLevelTextSize: 17,
}

/** Default view limits of a spectrum (PlotConfig.update_plot_limits, XPS rule). */
export function defaultLimits(xs: readonly (number | null)[], ys: readonly (number | null)[]): { xmin: number; xmax: number; ymin: number; ymax: number } | null {
  let xmin = Infinity
  let xmax = -Infinity
  let ymin = Infinity
  let ymax = -Infinity
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    const y = ys[i]
    if (x !== null && Number.isFinite(x)) {
      xmin = Math.min(xmin, x)
      xmax = Math.max(xmax, x)
    }
    if (y !== null && y !== undefined && Number.isFinite(y)) {
      ymin = Math.min(ymin, y)
      ymax = Math.max(ymax, y)
    }
  }
  if (!(xmin < xmax) || !(ymin <= ymax)) return null
  const lo = ymin - 0.015 * ymax
  let hi = ymax * 1.2
  if (!(hi > lo)) hi = lo + Math.abs(lo || 1) * 0.1
  return { xmin, xmax, ymin: lo, ymax: hi }
}

/** Number to text as Python's str(float) for the status bar readouts. */
export const fixed = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '')
