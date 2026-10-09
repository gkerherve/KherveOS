// Draws a figure from figures.ts with Plotly. Plotly (4.8 MB) is loaded the first time a chart is shown, never before.
// The chart can also be exported as PNG or SVG: it is then drawn again with the light palette on white, so that the
// picture reads on paper whatever the theme.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { DEFAULT_PALETTE, LIGHT_PALETTE, type Figure, type Palette } from './figures'

interface PlotlyLike {
  react(el: HTMLElement, data: unknown, layout: unknown, config: unknown): Promise<unknown>
  newPlot(el: HTMLElement, data: unknown, layout: unknown, config: unknown): Promise<unknown>
  toImage(el: HTMLElement, opts: { format: 'png' | 'svg'; width: number; height: number; scale?: number }): Promise<string>
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

/** The theme colours as "rgb(...)" strings (the browser resolves the CSS variables). */
function readPalette(): Palette {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const get = (v: string, fallback: string) => {
    probe.style.color = ''
    probe.style.color = `var(${v})`
    return getComputedStyle(probe).color || fallback
  }
  const pal: Palette = {
    text: get('--k-text', DEFAULT_PALETTE.text),
    muted: get('--k-muted', DEFAULT_PALETTE.muted),
    border: get('--k-border', DEFAULT_PALETTE.border),
    accent: get('--k-accent', DEFAULT_PALETTE.accent),
    link: get('--k-link', DEFAULT_PALETTE.link),
    danger: get('--k-danger', DEFAULT_PALETTE.danger),
    success: get('--k-success', DEFAULT_PALETTE.success),
    warning: get('--k-warning', DEFAULT_PALETTE.warning),
    surface: get('--k-surface', DEFAULT_PALETTE.surface),
  }
  probe.remove()
  return pal
}

/** The theme's colours, read again when the theme changes. */
export function usePalette(): Palette {
  const [pal, setPal] = useState<Palette>(DEFAULT_PALETTE)
  useEffect(() => {
    const update = () => {
      const next = readPalette()
      setPal((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
    }
    update()
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true })
    obs.observe(document.body, { attributes: true })
    return () => obs.disconnect()
  }, [])
  return pal
}

export interface ChartHandle {
  /** The chart as a picture: PNG bytes, or SVG text. */
  exportImage(format: 'png' | 'svg', title?: string): Promise<Uint8Array | string>
}

interface Props {
  /** Builds the figure for a palette (memoise it: the chart is redrawn when it changes). */
  build: (pal: Palette) => Figure | null
  height?: number
  /** Shown when there is nothing to draw. */
  empty?: string
}

const PlotlyChart = forwardRef<ChartHandle, Props>(function PlotlyChart({ build, height = 320, empty = 'Nothing to draw yet.' }, handle) {
  const ref = useRef<HTMLDivElement>(null)
  const plotly = useRef<PlotlyLike | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const pal = usePalette()
  const figure = useMemo(() => {
    try { return build(pal) } catch { return null }
  }, [build, pal])

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
    void p.react(el, figure.data, { ...figure.layout, autosize: true }, { displaylogo: false, responsive: false, displayModeBar: 'hover', modeBarButtonsToRemove: ['lasso2d', 'select2d'] })
  }, [state, figure])

  useEffect(() => {
    const el = ref.current
    const p = plotly.current
    if (state !== 'ready' || !el || !p) return
    const ro = new ResizeObserver(() => { try { p.Plots.resize(el) } catch { /* not drawn yet */ } })
    ro.observe(el)
    return () => {
      ro.disconnect()
      try { p.purge(el) } catch { /* already gone */ }
    }
  }, [state])

  useImperativeHandle(handle, () => ({
    async exportImage(format, title) {
      const p = await loadPlotly()
      const fig = build(LIGHT_PALETTE)
      if (!fig) throw new Error('There is nothing to export yet.')
      const holder = document.createElement('div')
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:700px;'
      document.body.appendChild(holder)
      try {
        const layout = { ...fig.layout, width: 1200, height: 700, autosize: false, ...(title ? { title: { text: title, font: { size: 16, color: LIGHT_PALETTE.text } }, margin: { ...(fig.layout.margin as object), t: 56 } } : {}) }
        await p.newPlot(holder, fig.data, layout, { staticPlot: true })
        const url = await p.toImage(holder, { format, width: 1200, height: 700, scale: format === 'png' ? 2 : 1 })
        if (format === 'svg') {
          const body = url.slice(url.indexOf(',') + 1)
          return url.includes(';base64,') ? atob(body) : decodeURIComponent(body)
        }
        const bin = atob(url.slice(url.indexOf(',') + 1))
        return Uint8Array.from(bin, (c) => c.charCodeAt(0))
      } finally {
        try { p.purge(holder) } catch { /* ignore */ }
        holder.remove()
      }
    },
  }), [build])

  return (
    <div className="cl-chart" style={{ height }}>
      {state === 'loading' && <div className="cl-chart-note k-muted">Loading the chart…</div>}
      {state === 'error' && <div className="cl-chart-note k-muted">The chart library could not be loaded.</div>}
      {state === 'ready' && !figure && <div className="cl-chart-note k-muted">{empty}</div>}
      <div ref={ref} className="cl-chart-plot" style={{ display: state === 'ready' && figure ? 'block' : 'none' }} />
    </div>
  )
})

export default PlotlyChart
