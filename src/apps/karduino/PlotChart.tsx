// The serial plotter chart: a live multi-series SVG line chart in theme colours.

import { useEffect, useRef, useState } from 'react'
import { colorOf, linePath, niceTicks, plotRange, type Column } from './plotter'

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 320, h: 180 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: Math.max(120, el.clientWidth), h: Math.max(80, el.clientHeight) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

const fmt = (v: number) => (Math.abs(v) >= 1000 || Number.isInteger(v) ? String(Math.round(v * 100) / 100) : v.toPrecision(3).replace(/\.?0+$/, ''))

export function PlotChart({ columns, hidden, total }: { columns: Column[]; hidden: ReadonlySet<string>; total: number }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>()
  const left = 44
  const right = 8
  const top = 8
  const bottom = 16
  const shown = columns.filter((c) => !hidden.has(c.name))
  let min = Infinity
  let max = -Infinity
  for (const c of shown) for (const v of c.values) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v }
  const { lo, hi } = plotRange(min <= max ? { min, max } : null)
  const n = columns[0]?.values.length ?? 0
  const x = (i: number) => left + (n <= 1 ? 0 : (i / (n - 1)) * (w - left - right))
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (h - top - bottom)
  const ticks = niceTicks(lo, hi, Math.max(2, Math.floor((h - top - bottom) / 34)))
  return (
    <div className="ka-chart" ref={ref}>
      <svg width={w} height={h} role="img" aria-label="Serial plotter">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={w - right} y1={y(t)} y2={y(t)} className="ka-grid" />
            <text x={left - 5} y={y(t) + 3.5} textAnchor="end" className="ka-axis">{fmt(t)}</text>
          </g>
        ))}
        <line x1={left} x2={left} y1={top} y2={h - bottom} className="ka-grid" />
        <text x={left} y={h - 3} className="ka-axis">{Math.max(0, total - n)}</text>
        <text x={w - right} y={h - 3} textAnchor="end" className="ka-axis">{total}</text>
        {columns.map((c, i) =>
          hidden.has(c.name) ? null : (
            <path key={c.name} d={linePath(c.values, x, y)} fill="none" stroke={colorOf(i)} strokeWidth={1.6} strokeLinejoin="round" />
          ),
        )}
      </svg>
      {n === 0 && <div className="ka-chart-empty k-muted">Waiting for numbers: 1,2,3 or a:1 b:2 on each line.</div>}
    </div>
  )
}
