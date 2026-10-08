// Draws a figure from figures.ts with Plotly. Plotly (4.8 MB) is loaded the first time a chart is shown.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { DEFAULT_PALETTE, type Figure, type Palette } from './figures'

interface PlotlyLike {
  react(el: HTMLElement, data: unknown, layout: unknown, config: unknown): Promise<unknown>
  purge(el: HTMLElement): void
  Plots: { resize(el: HTMLElement): void }
  toImage(el: HTMLElement, opts: { format: 'png' | 'svg' | 'jpeg'; width?: number; height?: number; scale?: number }): Promise<string>
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
  const d = DEFAULT_PALETTE
  const pal: Palette = {
    text: get('--k-text', d.text), muted: get('--k-muted', d.muted), border: get('--k-border', d.border), accent: get('--k-accent', d.accent),
    link: get('--k-link', d.link), danger: get('--k-danger', d.danger), success: get('--k-success', d.success), warning: get('--k-warning', d.warning),
    surface: get('--k-surface', d.surface),
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
  /** The chart as an image data URL (png or svg). Null while Plotly is still loading. */
  toImage(format: 'png' | 'svg', width?: number, height?: number): Promise<string | null>
}

interface Props {
  figure: Figure | null
  /** The same chart in print colours (dark ink on white) for PNG / SVG files; the screen figure is used when absent. */
  printFigure?: Figure | null
  height?: number
  empty?: string
}

/** The text of an SVG data URL. */
export function svgFromDataUrl(url: string): string {
  const i = url.indexOf(',')
  const body = url.slice(i + 1)
  return url.slice(0, i).includes(';base64') ? atob(body) : decodeURIComponent(body)
}

const PlotlyChart = forwardRef<ChartHandle, Props>(function PlotlyChart({ figure, printFigure, height = 300, empty = 'Nothing to draw yet.' }, handle) {
  const ref = useRef<HTMLDivElement>(null)
  const plotly = useRef<PlotlyLike | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useImperativeHandle(handle, () => ({
    async toImage(format, width, height) {
      const el = ref.current
      const p = plotly.current
      if (!el || !p) return null
      const w = width ?? Math.max(480, el.clientWidth)
      const h = height ?? Math.max(300, el.clientHeight)
      const fig = printFigure ?? figure
      if (!fig) return null
      // drawn again off screen in print colours so the file reads on a white page
      const holder = document.createElement('div')
      holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px`
      document.body.appendChild(holder)
      try {
        await p.react(holder, fig.data, { ...fig.layout, autosize: false, width: w, height: h }, { staticPlot: true, displayModeBar: false })
        return await p.toImage(holder, { format, width: w, height: h, scale: format === 'png' ? 2 : 1 })
      } finally {
        try { p.purge(holder) } catch { /* gone */ }
        holder.remove()
      }
    },
  }))

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
    <div className="kr-chart" style={{ height }}>
      {state === 'loading' && <div className="kr-chart-note k-muted">Loading the chart…</div>}
      {state === 'error' && <div className="kr-chart-note k-muted">The chart library could not be loaded.</div>}
      {state === 'ready' && !figure && <div className="kr-chart-note k-muted">{empty}</div>}
      <div ref={ref} className="kr-chart-plot" style={{ display: state === 'ready' && figure ? 'block' : 'none' }} />
    </div>
  )
})

export default PlotlyChart
