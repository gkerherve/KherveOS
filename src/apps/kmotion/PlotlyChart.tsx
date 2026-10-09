// Draws a figure from figures.ts with Plotly. Plotly (4.8 MB) is loaded the first time a chart is shown.

import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PALETTE, type Figure, type Palette } from './figures'

interface PlotlyLike {
  react(el: HTMLElement, data: unknown, layout: unknown, config: unknown): Promise<unknown>
  purge(el: HTMLElement): void
  Plots: { resize(el: HTMLElement): void }
}

let loading: Promise<PlotlyLike> | null = null
function loadPlotly(): Promise<PlotlyLike> {
  loading ??= import('plotly.js-dist-min').then((m) => {
    const mod = m as unknown as { default?: PlotlyLike } & PlotlyLike
    return mod.default ?? mod
  })
  return loading
}

/** CSS colours as "rgb(...)" strings, resolved by the browser from the theme variables. */
function resolveColors(vars: Record<string, string>): Record<string, string> {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    probe.style.color = ''
    probe.style.color = `var(${v.split('|')[0]})`
    out[k] = getComputedStyle(probe).color || v.split('|')[1]
  }
  probe.remove()
  return out
}

export function readPalette(): Palette {
  const c = resolveColors({
    text: `--k-text|${DEFAULT_PALETTE.text}`, muted: `--k-muted|${DEFAULT_PALETTE.muted}`, border: `--k-border|${DEFAULT_PALETTE.border}`, accent: `--k-accent|${DEFAULT_PALETTE.accent}`,
    link: `--k-link|${DEFAULT_PALETTE.link}`, danger: `--k-danger|${DEFAULT_PALETTE.danger}`, surface: `--k-surface|${DEFAULT_PALETTE.surface}`,
  })
  return c as unknown as Palette
}

/** The theme's colours for the canvas (the chrome of the picture), read again when the theme changes. */
export interface CanvasTheme { bg: string; text: string; muted: string; border: string; accent: string; surface: string }
export const DEFAULT_CANVAS_THEME: CanvasTheme = { bg: '#111827', text: '#e5e7eb', muted: '#9ca3af', border: '#374151', accent: '#34d399', surface: '#1f2937' }

export function readCanvasTheme(): CanvasTheme {
  return resolveColors({
    bg: `--k-bg|${DEFAULT_CANVAS_THEME.bg}`, text: `--k-text|${DEFAULT_CANVAS_THEME.text}`, muted: `--k-muted|${DEFAULT_CANVAS_THEME.muted}`, border: `--k-border|${DEFAULT_CANVAS_THEME.border}`,
    accent: `--k-accent|${DEFAULT_CANVAS_THEME.accent}`, surface: `--k-surface|${DEFAULT_CANVAS_THEME.surface}`,
  }) as unknown as CanvasTheme
}

/** Re-reads `read()` whenever the theme (an attribute of <html> or <body>) changes. */
export function useThemed<T>(read: () => T, initial: T): T {
  const [v, setV] = useState<T>(initial)
  useEffect(() => {
    const update = () => {
      const next = read()
      setV((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
    }
    update()
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true })
    obs.observe(document.body, { attributes: true })
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return v
}

export const usePalette = () => useThemed(readPalette, DEFAULT_PALETTE)

export default function PlotlyChart({ figure, height }: { figure: Figure | null; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const plotly = useRef<PlotlyLike | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let dead = false
    loadPlotly().then(
      (p) => {
        if (dead) return
        plotly.current = p
        setState('ready')
      },
      () => !dead && setState('error'),
    )
    return () => { dead = true }
  }, [])

  useEffect(() => {
    const el = ref.current
    const p = plotly.current
    if (state !== 'ready' || !el || !p || !figure) return
    void p.react(el, figure.data, { ...figure.layout, autosize: true }, {
      displaylogo: false, responsive: false, displayModeBar: 'hover', modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    })
  }, [state, figure])

  useEffect(() => {
    const el = ref.current
    const p = plotly.current
    if (state !== 'ready' || !el || !p) return
    const ro = new ResizeObserver(() => p.Plots.resize(el))
    ro.observe(el)
    return () => {
      ro.disconnect()
      try { p.purge(el) } catch { /* already gone */ }
    }
  }, [state])

  return (
    <div className="mo-chart" style={height ? { height } : undefined}>
      {state === 'loading' && <div className="mo-chart-note k-muted">Loading the chart…</div>}
      {state === 'error' && <div className="mo-chart-note k-muted">The chart library could not be loaded.</div>}
      {state === 'ready' && !figure && <div className="mo-chart-note k-muted">Nothing to draw yet.</div>}
      <div ref={ref} className="mo-chart-plot" style={{ display: state === 'ready' && figure ? 'block' : 'none' }} />
    </div>
  )
}
