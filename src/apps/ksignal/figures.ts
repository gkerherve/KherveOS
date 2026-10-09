// The charts of kSignal as plain Plotly figures ({ data, layout }) (pure: no browser, no Plotly import).
// PlotlyChart.tsx loads Plotly lazily and draws them; the colours come in as a palette read from the theme.

import { minMaxDecimate, reduceMatrix, type TimePeak } from './dsp.ts'
import { cabs, frequencyGrid, frequencyResponse, stepResponse, impulseResponse, type FilterDesign } from './filters.ts'
import type { AnalysisSettings } from './project.ts'
import type { Psd, Spectrum, SpectrumPeak, Stft } from './spectrum.ts'
import { WINDOW_LABELS, type WindowName } from './windows.ts'

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
  warning: string
  success: string
  surface: string
}

export const DEFAULT_PALETTE: Palette = {
  text: '#e5e7eb', muted: '#9ca3af', border: '#374151', accent: '#34d399', link: '#60a5fa', danger: '#f87171', warning: '#fbbf24', success: '#4ade80', surface: '#1f2937',
}

/** For exported images: dark ink on white. */
export const LIGHT_PALETTE: Palette = {
  text: '#111827', muted: '#4b5563', border: '#d1d5db', accent: '#047857', link: '#1d4ed8', danger: '#b91c1c', warning: '#b45309', success: '#15803d', surface: '#ffffff',
}

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

function axis(pal: Palette, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: { text: title, standoff: 6, font: { size: 11 } }, gridcolor: withAlpha(pal.border, 0.7), linecolor: pal.border, zeroline: false,
    tickfont: { color: pal.muted, size: 10 }, automargin: true, ...extra,
  }
}

/** An x axis with a dotted cross-hair that follows the pointer. */
function xaxis(pal: Palette, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return axis(pal, title, { showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikethickness: 1, spikecolor: pal.muted, spikedash: 'dot', ...extra })
}

function base(pal: Palette, xTitle: string, yTitle: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: pal.text, size: 11, family: 'inherit' },
    margin: { l: 54, r: 14, t: 10, b: 40 }, xaxis: xaxis(pal, xTitle), yaxis: axis(pal, yTitle),
    legend: { orientation: 'h', y: 1.0, yanchor: 'bottom', font: { color: pal.muted, size: 10 } }, hoverlabel: { font: { family: 'inherit' } },
    hovermode: 'x', hoverdistance: -1, dragmode: 'zoom', ...extra,
  }
}

/** An opaque white background for exported images. */
export function forExport(f: Figure, pal: Palette): Figure {
  return { data: f.data, layout: { ...f.layout, paper_bgcolor: pal.surface, plot_bgcolor: pal.surface, width: 1000, height: 560 } }
}

// ------------------------------------------------------------------------------------------------- time

export interface TimeInput {
  x: ArrayLike<number>
  fs: number
  processed?: { x: ArrayLike<number>; fs: number } | null
  /** Visible range, seconds (null: everything). */
  view: [number, number] | null
  cursors: { a: number | null; b: number | null }
  peaks?: readonly TimePeak[]
  showOriginal: boolean
  showProcessed: boolean
}

const MAX_POINTS = 4000

function line(x: number[], y: number[], name: string, color: string, width = 1.2, extra: Record<string, unknown> = {}): Trace {
  return { type: 'scatter', mode: 'lines', x, y, name, line: { color, width }, hovertemplate: '%{x:.6g}, %{y:.5g}<extra>' + name + '</extra>', ...extra }
}

/** A vertical line at x over the whole plot height, drawn as a trace on a hidden overlay axis (works on log axes too). */
function vline(x: number, color: string, label: string, dash = 'dot'): Trace {
  return {
    type: 'scatter', mode: 'lines+text', x: [x, x], y: [0, 1], yaxis: 'y2', text: ['', label], textposition: 'top right', textfont: { color, size: 11 },
    line: { color, width: 1, dash }, hoverinfo: 'skip', showlegend: false, cliponaxis: false,
  }
}

/** The overlay axis the vertical lines live on: 0 … 1 over the plot height. */
const OVERLAY = { overlaying: 'y', range: [0, 1], visible: false, fixedrange: true } as const

function cursorTraces(pal: Palette, cursors: { a: number | null; b: number | null }, log = false): Trace[] {
  const out: Trace[] = []
  if (cursors.a !== null && (!log || cursors.a > 0)) out.push(vline(cursors.a, pal.warning, 'A'))
  if (cursors.b !== null && (!log || cursors.b > 0)) out.push(vline(cursors.b, pal.link, 'B'))
  return out
}

export function timeFigure(i: TimeInput, pal: Palette): Figure {
  const data: Trace[] = []
  const dur = i.x.length / i.fs
  const [t0, t1] = i.view ?? [0, dur]
  const draw = (x: ArrayLike<number>, fs: number, name: string, color: string, width: number) => {
    const d = minMaxDecimate((k) => k / fs, x, Math.floor(t0 * fs) - 1, Math.ceil(t1 * fs) + 1, MAX_POINTS)
    data.push(line(d.x, d.y, name, color, width))
  }
  if (i.showOriginal || !i.processed) draw(i.x, i.fs, 'original', i.processed && i.showProcessed ? withAlpha(pal.muted, 0.9) : pal.link, 1.1)
  if (i.processed && i.showProcessed) draw(i.processed.x, i.processed.fs, 'processed', pal.accent, 1.5)
  if (i.peaks?.length) {
    const vis = i.peaks.filter((p) => p.time >= t0 && p.time <= t1)
    data.push({ type: 'scatter', mode: 'markers', x: vis.map((p) => p.time), y: vis.map((p) => p.value), name: 'peaks', marker: { color: pal.danger, size: 8, symbol: 'triangle-down' }, hovertemplate: '%{x:.4f} s, %{y:.4g}<extra>peak</extra>' })
  }
  data.push(...cursorTraces(pal, i.cursors))
  return { data, layout: base(pal, 'Time (s)', 'Amplitude', { xaxis: xaxis(pal, 'Time (s)', { range: [t0, t1] }), yaxis2: OVERLAY }) }
}

// ------------------------------------------------------------------------------------------------- spectrum

export interface SpectrumInput {
  primary: Spectrum
  /** The other trace (original when primary is processed, or the reverse), drawn behind. */
  other?: { spectrum: Spectrum; name: string } | null
  primaryName: string
  compare: Array<{ window: WindowName; spectrum: Spectrum }>
  peaks: readonly SpectrumPeak[]
  settings: AnalysisSettings
  cursors: { a: number | null; b: number | null }
}

const VISIBLE_LIMIT = 6000

function ampValue(a: number, scale: AnalysisSettings['scale']): number {
  return scale === 'linear' ? a : 20 * Math.log10(Math.max(a, 1e-15))
}

function axisRange(s: AnalysisSettings, ymax: number, scale: AnalysisSettings['scale']): Record<string, unknown> {
  if (scale === 'linear') return { range: [0, s.dbMax ?? (ymax * 1.08 || 1)] }
  const top = s.dbMax ?? Math.ceil((ymax + 6) / 10) * 10
  return { range: [Math.min(s.dbMin, top - 20), top] }
}

export function spectrumFigure(i: SpectrumInput, pal: Palette): Figure {
  const s = i.settings
  const fmax = Math.min(s.fMax ?? Infinity, i.primary.fs / 2)
  const yTitle = s.scale === 'linear' ? 'Amplitude' : 'Amplitude (dB re 1)'
  const data: Trace[] = []
  let top = -Infinity
  const draw = (sp: Spectrum, name: string, color: string, width: number, dash?: string) => {
    const last = Math.min(sp.amp.length, Math.floor(fmax / sp.df) + 2)
    const first = s.logFreq ? 1 : 0
    const y = new Float64Array(last)
    for (let k = 0; k < last; k++) y[k] = ampValue(sp.amp[k], s.scale)
    for (let k = first; k < last; k++) if (y[k] > top) top = y[k]
    const d = minMaxDecimate(sp.freq, y, first, last, VISIBLE_LIMIT)
    data.push(line(d.x, d.y, name, color, width, dash ? { line: { color, width, dash } } : {}))
  }
  if (i.other) draw(i.other.spectrum, i.other.name, withAlpha(pal.muted, 0.9), 1)
  i.compare.forEach((c, n) => draw(c.spectrum, WINDOW_LABELS[c.window], [pal.warning, pal.danger, pal.link, pal.success][n % 4], 1, 'dot'))
  draw(i.primary, i.primaryName, pal.accent, 1.5)
  if (i.peaks.length) {
    data.push({
      type: 'scatter', mode: 'markers+text', x: i.peaks.map((p) => p.freq), y: i.peaks.map((p) => ampValue(p.amp, s.scale)), name: 'peaks',
      text: i.peaks.map((_, n) => String(n + 1)), textposition: 'top center', textfont: { color: pal.danger, size: 10 }, marker: { color: pal.danger, size: 6 },
      hovertemplate: '%{x:.6g} Hz<extra>peak</extra>', showlegend: false,
    })
  }
  data.push(...cursorTraces(pal, i.cursors, s.logFreq))
  const xr = s.logFreq ? [Math.log10(Math.max(i.primary.df, fmax / 1e4)), Math.log10(fmax)] : [0, fmax]
  return {
    data,
    layout: base(pal, 'Frequency (Hz)', yTitle, {
      xaxis: xaxis(pal, 'Frequency (Hz)', { type: s.logFreq ? 'log' : 'linear', range: xr }),
      yaxis: axis(pal, yTitle, axisRange(s, top, s.scale)), yaxis2: OVERLAY,
      uirevision: `spectrum|${i.primary.fs}|${i.primary.nfft}|${s.scale}|${s.logFreq}|${s.fMax}|${s.dbMin}|${s.dbMax}`,
    }),
  }
}

export interface PsdInput { psd: Psd; settings: AnalysisSettings; cursors: { a: number | null; b: number | null }; extra?: { psd: Psd; name: string } | null; name: string }

export function psdFigure(i: PsdInput, pal: Palette): Figure {
  const s = i.settings
  const fmax = Math.min(s.fMax ?? Infinity, i.psd.freq[i.psd.freq.length - 1])
  const data: Trace[] = []
  let top = -Infinity
  const draw = (p: Psd, name: string, color: string, width: number) => {
    const last = Math.min(p.freq.length, Math.ceil(fmax / (p.freq[1] || 1)) + 2)
    const first = s.logFreq ? 1 : 0
    const y = new Float64Array(last)
    for (let k = 0; k < last; k++) y[k] = 10 * Math.log10(Math.max(p.psd[k], 1e-30))
    for (let k = first; k < last; k++) if (y[k] > top) top = y[k]
    const d = minMaxDecimate(p.freq, y, first, last, VISIBLE_LIMIT)
    data.push(line(d.x, d.y, name, color, width))
  }
  if (i.extra) draw(i.extra.psd, i.extra.name, withAlpha(pal.muted, 0.9), 1)
  draw(i.psd, i.name, pal.accent, 1.5)
  data.push(...cursorTraces(pal, i.cursors, s.logFreq))
  const yTitle = i.psd.scaling === 'density' ? 'PSD (dB re 1 V²/Hz)' : 'Power (dB re 1 V²)'
  const topR = s.dbMax ?? Math.ceil((top + 6) / 10) * 10
  return {
    data,
    layout: base(pal, 'Frequency (Hz)', yTitle, {
      xaxis: xaxis(pal, 'Frequency (Hz)', { type: s.logFreq ? 'log' : 'linear', range: s.logFreq ? [Math.log10(Math.max(i.psd.freq[1] || 1, fmax / 1e4)), Math.log10(fmax)] : [0, fmax] }),
      yaxis: axis(pal, yTitle, { range: [Math.min(topR - 20, topR - Math.max(40, topR - (s.dbMin - 20))), topR] }), yaxis2: OVERLAY,
      uirevision: `psd|${i.psd.nperseg}|${s.logFreq}|${s.fMax}|${s.dbMin}|${s.dbMax}`,
    }),
  }
}

// ------------------------------------------------------------------------------------------------- spectrogram

export function spectrogramFigure(st: Stft, s: AnalysisSettings, pal: Palette): Figure {
  const fmax = Math.min(s.fMax ?? Infinity, st.fs / 2)
  const lastBin = Math.min(st.freq.length, Math.floor(fmax / (st.freq[1] || 1)) + 2)
  const frames = st.frames.map((f) => f.subarray(0, lastBin))
  const r = reduceMatrix(frames, 700, 420)
  const db = r.z.map((row) => row.map((v) => 20 * Math.log10(Math.max(v, 1e-12))))
  let top = -Infinity
  for (const row of db) for (const v of row) if (v > top) top = v
  const zmax = s.specMax ?? Math.ceil(top / 5) * 5
  return {
    data: [{
      type: 'heatmap', x: r.tIdx.map((t) => st.time[t]), y: r.fIdx.map((f) => st.freq[f]), z: db, zmin: Math.min(s.specMin, zmax - 10), zmax,
      colorscale: 'Viridis', colorbar: { title: { text: 'dB', font: { size: 10 } }, thickness: 12, tickfont: { color: pal.muted, size: 10 }, outlinewidth: 0 },
      hovertemplate: '%{x:.4f} s, %{y:.5g} Hz: %{z:.1f} dB<extra></extra>',
    }],
    layout: base(pal, 'Time (s)', 'Frequency (Hz)', { hovermode: 'closest', xaxis: axis(pal, 'Time (s)'), yaxis: axis(pal, 'Frequency (Hz)', { range: [0, fmax] }), margin: { l: 60, r: 10, t: 10, b: 40 }, uirevision: `stft|${st.fs}|${st.nperseg}|${st.frames.length}|${s.fMax}` }),
  }
}

// ------------------------------------------------------------------------------------------------- filter

export interface DesignLine { design: FilterDesign; name: string; color: string }

function fgrid(designs: DesignLine[], log: boolean): Float64Array {
  const fs = designs[0]?.design.fs ?? 2
  // very long FIR filters cost a trigonometric sum per point: fewer points for them
  const n = Math.max(...designs.map((d) => d.design.b.length), 0) > 1000 ? 300 : 700
  return log ? frequencyGrid(Math.max(fs / 20000, 0.01), fs / 2, n, true) : frequencyGrid(0, fs / 2, n)
}

function cutoffTraces(designs: DesignLine[], pal: Palette, log: boolean): Trace[] {
  const d = designs[0]?.design
  if (!d || d.spec.family === 'scipy') return []
  const spec = d.spec
  const edges = spec.family === 'notch' ? [spec.f1] : spec.type === 'bandpass' || spec.type === 'bandstop' ? [spec.f1, spec.f2] : [spec.f1]
  return edges.filter((f) => !log || f > 0).map((f) => vline(f, withAlpha(pal.warning, 0.8), ''))
}

export function magnitudeFigure(designs: DesignLine[], pal: Palette, opts: { log?: boolean; floor?: number } = {}): Figure {
  const f = fgrid(designs, !!opts.log)
  const data = designs.map(({ design, name, color }) => line(Array.from(f), Array.from(frequencyResponse(design, f).magDb, (v) => Math.max(v, (opts.floor ?? -120) - 20)), name, color, 1.6))
  data.push(...cutoffTraces(designs, pal, !!opts.log))
  const shapes: Trace[] = [{ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: -3.0103, y1: -3.0103, line: { color: withAlpha(pal.muted, 0.6), width: 1, dash: 'dot' } }]
  return { data, layout: base(pal, 'Frequency (Hz)', 'Magnitude (dB)', { xaxis: xaxis(pal, 'Frequency (Hz)', { type: opts.log ? 'log' : 'linear' }), yaxis: axis(pal, 'Magnitude (dB)', { range: [opts.floor ?? -100, 6] }), yaxis2: OVERLAY, shapes }) }
}

export function phaseFigure(designs: DesignLine[], pal: Palette, log = false): Figure {
  const f = fgrid(designs, log)
  const data = designs.map(({ design, name, color }) => line(Array.from(f), Array.from(frequencyResponse(design, f).phase, (v) => (v * 180) / Math.PI), name, color, 1.6))
  return { data, layout: base(pal, 'Frequency (Hz)', 'Phase (°)', { xaxis: xaxis(pal, 'Frequency (Hz)', { type: log ? 'log' : 'linear' }) }) }
}

export function groupDelayFigure(designs: DesignLine[], pal: Palette, log = false): Figure {
  const f = fgrid(designs, log)
  const data = designs.map(({ design, name, color }) => line(Array.from(f), Array.from(frequencyResponse(design, f).groupDelay, (v) => (v / design.fs) * 1000), name, color, 1.6))
  return { data, layout: base(pal, 'Frequency (Hz)', 'Group delay (ms)', { xaxis: xaxis(pal, 'Frequency (Hz)', { type: log ? 'log' : 'linear' }) }) }
}

export function poleZeroFigure(designs: DesignLine[], pal: Palette): Figure {
  const data: Trace[] = []
  const circle: number[] = []
  const cx: number[] = []
  const cy: number[] = []
  for (let k = 0; k <= 180; k++) { const a = (2 * Math.PI * k) / 180; circle.push(Math.cos(a)); cx.push(Math.cos(a)); cy.push(Math.sin(a)) }
  data.push({ type: 'scatter', mode: 'lines', x: cx, y: cy, line: { color: withAlpha(pal.muted, 0.7), width: 1 }, hoverinfo: 'skip', showlegend: false })
  for (const { design, name, color } of designs) {
    const z = design.zeros
    const p = design.poles.filter((q) => cabs(q) > 1e-9 || design.kind === 'iir')
    data.push({ type: 'scatter', mode: 'markers', x: z.map((q) => q.re), y: z.map((q) => q.im), name: `${name} zeros`, marker: { symbol: 'circle-open', size: 9, color, line: { width: 2, color } }, hovertemplate: '%{x:.4f} %{y:+.4f}i<extra>zero</extra>' })
    data.push({ type: 'scatter', mode: 'markers', x: p.map((q) => q.re), y: p.map((q) => q.im), name: `${name} poles`, marker: { symbol: 'x', size: 9, color, line: { width: 2, color } }, hovertemplate: '%{x:.4f} %{y:+.4f}i<extra>pole</extra>' })
  }
  return {
    data,
    layout: base(pal, 'Real', 'Imaginary', {
      hovermode: 'closest', xaxis: axis(pal, 'Real', { range: [-1.6, 1.6], scaleanchor: 'y', scaleratio: 1 }), yaxis: axis(pal, 'Imaginary', { range: [-1.6, 1.6] }),
      legend: { orientation: 'h', y: 1.0, yanchor: 'bottom', font: { color: pal.muted, size: 10 } },
    }),
  }
}

export function stepFigure(designs: DesignLine[], pal: Palette, kind: 'step' | 'impulse' = 'step'): Figure {
  const data = designs.map(({ design, name, color }) => {
    const n = design.kind === 'fir' ? Math.max(64, design.b.length * 2) : Math.min(2000, Math.max(100, Math.round(design.fs / Math.max(design.spec.f1, 1) * 12)))
    const y = kind === 'step' ? stepResponse(design, n) : impulseResponse(design, n)
    return line(Array.from({ length: n }, (_, k) => (k / design.fs) * 1000), Array.from(y), name, color, 1.4)
  })
  return { data, layout: base(pal, 'Time (ms)', kind === 'step' ? 'Step response' : 'Impulse response') }
}
