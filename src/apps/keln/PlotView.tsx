// The Plot block's chart: Plotly (4.8 MB, loaded the first time a chart is shown), with the pure SVG as the fallback
// and while it loads.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlotData } from './blocks'
import { plotData, plotSvg } from './plot'
import { Html } from './ui'

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

function colours() {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const get = (v: string, fallback: string) => {
    probe.style.color = ''
    probe.style.color = `var(${v})`
    return getComputedStyle(probe).color || fallback
  }
  const c = { text: get('--k-text', '#ddd'), muted: get('--k-muted', '#999'), grid: get('--k-border', '#444'), series: [get('--k-accent', '#4a9'), get('--k-danger', '#d55'), get('--k-success', '#5b5'), get('--k-warning', '#db4'), get('--k-link', '#59f'), get('--k-muted', '#999')] }
  probe.remove()
  return c
}

export function PlotView({ data, height = 280 }: { data: PlotData; height?: number }) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const plotly = useRef<PlotlyLike | null>(null)
  const nums = useMemo(() => plotData(data), [data])
  const hasData = nums.y.some((s) => s.some((v) => v != null))

  useEffect(() => {
    let dead = false
    loadPlotly().then((p) => { if (!dead) { plotly.current = p; setState('ready') } }, () => { if (!dead) setState('error') })
    return () => { dead = true }
  }, [])

  useEffect(() => {
    const el = host.current
    const p = plotly.current
    if (state !== 'ready' || !el || !p || !hasData) return
    const c = colours()
    const categorical = data.kind === 'bar' || nums.x.some((v) => v == null)
    const xs = categorical ? nums.labels : nums.x
    const traces = data.series.map((name, i) => ({
      x: xs, y: nums.y[i], name, type: data.kind === 'bar' ? 'bar' : 'scatter', mode: data.kind === 'scatter' ? 'markers' : 'lines+markers',
      marker: { color: c.series[i % c.series.length], size: 6 }, line: { color: c.series[i % c.series.length], width: 2 }, connectgaps: false,
    }))
    const layout = {
      title: data.title ? { text: data.title, font: { size: 13, color: c.text } } : undefined, margin: { l: 56, r: 14, t: data.title ? 34 : 14, b: 46 }, height,
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: c.text, size: 11 }, showlegend: data.series.length > 1,
      xaxis: { title: { text: data.xLabel }, gridcolor: c.grid, zerolinecolor: c.grid, linecolor: c.muted, type: categorical ? 'category' : 'linear' },
      yaxis: { title: { text: data.yLabel }, gridcolor: c.grid, zerolinecolor: c.grid, linecolor: c.muted },
    }
    void p.react(el, traces, layout, { displaylogo: false, responsive: true, displayModeBar: 'hover' })
  }, [state, data, nums, hasData, height])

  useEffect(() => {
    const el = host.current
    const p = plotly.current
    if (state !== 'ready' || !el || !p) return
    const ro = new ResizeObserver(() => { try { p.Plots.resize(el) } catch { /* not drawn yet */ } })
    ro.observe(el)
    return () => {
      ro.disconnect()
      try { p.purge(el) } catch { /* gone */ }
    }
  }, [state])

  if (!hasData) return <div className="ln-empty">Type numbers in the table to draw the plot.</div>
  const svg = plotSvg(data, { width: 560, height: 300, scheme: 'app' })
  return (
    <div className="ln-plot" style={{ minHeight: height }}>
      {state !== 'ready' && <Html html={svg} className="ln-plot-svg" />}
      <div ref={host} style={{ display: state === 'ready' ? 'block' : 'none' }} />
    </div>
  )
}
