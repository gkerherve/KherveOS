// Draws a figure from figures.ts with Plotly. Plotly (4.8 MB) is loaded the first time a chart is shown.

import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PALETTE, type Figure, type Palette } from './figures'

interface PlotlyLike {
  react(el: HTMLElement, data: unknown, layout: unknown, config: unknown): Promise<unknown>
  purge(el: HTMLElement): void
  toImage(fig: unknown, opts: { format: string; width: number; height: number; scale?: number }): Promise<string>
  Plots: { resize(el: HTMLElement): void }
}

type PlotDiv = HTMLElement & {
  on?: (ev: string, fn: (e: never) => void) => void
  removeAllListeners?: (ev: string) => void
}

let loading: Promise<PlotlyLike> | null = null
export function loadPlotly(): Promise<PlotlyLike> {
  loading ??= import('plotly.js-dist-min').then((m) => {
    const mod = m as unknown as { default?: PlotlyLike } & PlotlyLike
    return mod.default ?? mod
  })
  return loading
}

/** An image of a figure (PNG as bytes, SVG as text) without showing it. */
export async function figureImage(fig: Figure, format: 'png' | 'svg', width = 1000, height = 560): Promise<Uint8Array | string> {
  const p = await loadPlotly()
  const url = await p.toImage({ data: fig.data, layout: { ...fig.layout, width, height } }, { format, width, height, scale: format === 'png' ? 2 : 1 })
  if (format === 'svg') {
    const comma = url.indexOf(',')
    const body = url.slice(comma + 1)
    return url.slice(0, comma).includes('base64') ? atob(body) : decodeURIComponent(body)
  }
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
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
    warning: get('--k-warning', DEFAULT_PALETTE.warning),
    success: get('--k-success', DEFAULT_PALETTE.success),
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

export interface PlotlyChartProps {
  figure: Figure | null
  height?: number | string
  /** Click on the plot: the x value under the pointer and whether Shift was held. */
  onPlotClick?: (x: number, shift: boolean) => void
  /** The visible x range changed by zooming (null: back to automatic). */
  onXRange?: (range: [number, number] | null) => void
  empty?: string
}

export default function PlotlyChart({ figure, height = '100%', onPlotClick, onXRange, empty }: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const plotly = useRef<PlotlyLike | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const handlers = useRef({ onPlotClick, onXRange })
  handlers.current = { onPlotClick, onXRange }

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
    const el = ref.current as PlotDiv | null
    const p = plotly.current
    if (state !== 'ready' || !el || !p || !figure) return
    void p.react(el, figure.data, { ...figure.layout, autosize: true }, {
      displaylogo: false, responsive: false, displayModeBar: 'hover', modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    }).then(() => {
      el.removeAllListeners?.('plotly_click')
      el.removeAllListeners?.('plotly_relayout')
      el.on?.('plotly_click', ((e: { points?: Array<{ x?: unknown }>; event?: MouseEvent }) => {
        const x = Number(e.points?.[0]?.x)
        if (Number.isFinite(x)) handlers.current.onPlotClick?.(x, !!(e.event?.shiftKey || e.event?.altKey))
      }) as never)
      el.on?.('plotly_relayout', ((e: Record<string, unknown>) => {
        if (e['xaxis.autorange'] === true) handlers.current.onXRange?.(null)
        else if (typeof e['xaxis.range[0]'] === 'number' && typeof e['xaxis.range[1]'] === 'number') handlers.current.onXRange?.([e['xaxis.range[0]'] as number, e['xaxis.range[1]'] as number])
      }) as never)
    })
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

  return (
    <div className="sg-chart" style={{ height }}>
      {state === 'loading' && <div className="sg-chart-note k-muted">Loading the chart…</div>}
      {state === 'error' && <div className="sg-chart-note k-muted">The chart library could not be loaded.</div>}
      {state === 'ready' && !figure && <div className="sg-chart-note k-muted">{empty ?? 'Nothing to draw yet.'}</div>}
      <div ref={ref} className="sg-chart-plot" style={{ display: state === 'ready' && figure ? 'block' : 'none' }} />
    </div>
  )
}
