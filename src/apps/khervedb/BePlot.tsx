// "Plot results": a histogram of the binding energies in the results table,
// the BE axis reversed as usual in XPS. Drag across it to zoom, double-click
// to see everything again. The bin width and the smooth curve come from the
// Python KherveDB; "Auto" is the web version's choice (about 60 bars).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { RotateCcw } from 'lucide-react'
import { autoBin, histogram, kdeCurve, niceTicks } from './data'

const BINS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
const M = { left: 52, right: 16, top: 14, bottom: 42 }

interface Props {
  values: number[]
  /** What is plotted, e.g. "C 1s". */
  title: string
  /** Bin width in eV; 0 picks one from the range shown. */
  bin: number
  smooth: boolean
  onBin: (bin: number) => void
  onSmooth: (on: boolean) => void
}

const fmt = (v: number, step: number) => v.toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)

// SVG ids are shared by the whole page: each plot gets its own clip path.
let plotCount = 0

export default function BePlot({ values, title, bin: binPref, smooth, onBin, onSmooth }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [clipId] = useState(() => `kdb-plot-clip-${++plotCount}`)
  const [width, setWidth] = useState(640)
  const [zoom, setZoom] = useState<[number, number] | null>(null)
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; k: number } | null>(null)

  // As wide as the window it is in (measured before the first paint).
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const read = () => setWidth(Math.max(280, el.clientWidth))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The whole range, with a little room at both ends.
  const full = useMemo((): [number, number] => {
    if (!values.length) return [0, 1]
    let lo = Infinity
    let hi = -Infinity
    for (const v of values) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const pad = Math.max(0.5, (hi - lo) * 0.02)
    return [lo - pad, hi + pad]
  }, [values])
  useEffect(() => setZoom(null), [values])

  const [lo, hi] = zoom ?? full
  const bin = binPref > 0 ? binPref : autoBin(lo, hi)
  const height = Math.round(Math.min(360, Math.max(220, width * 0.5)))
  const pw = width - M.left - M.right
  const ph = height - M.top - M.bottom

  const hist = useMemo(() => histogram(values, lo, hi, bin), [values, lo, hi, bin])
  const curve = useMemo(() => (smooth ? kdeCurve(values, lo, hi, bin, Math.min(600, Math.round(pw / 2))) : []), [values, lo, hi, bin, smooth, pw])
  const shown = useMemo(() => hist.counts.reduce((a, b) => a + b, 0), [hist])

  const yMax = useMemo(() => {
    let max = 1
    for (const c of hist.counts) if (c > max) max = c
    for (const [, y] of curve) if (y > max) max = y
    return max * 1.08
  }, [hist, curve])

  // BE axis reversed: high binding energy on the left.
  const xOf = (v: number) => M.left + ((hi - v) / (hi - lo)) * pw
  const vOf = (px: number) => hi - ((px - M.left) / pw) * (hi - lo)
  const yOf = (c: number) => M.top + ph - (c / yMax) * ph

  // The bars and the curve are drawn once per range; hovering only moves the highlight.
  const marks = useMemo(() => {
    const x = (v: number) => M.left + ((hi - v) / (hi - lo)) * pw
    const y = (c: number) => M.top + ph - (c / yMax) * ph
    return (
      <>
        {hist.counts.map((c, k) => {
          if (!c) return null
          const from = hist.start + k * hist.bin
          const xa = x(from + hist.bin)
          const xb = x(from)
          const gap = xb - xa > 4 ? 1 : 0
          return <rect key={k} className="kdb-plot-bar" x={xa + gap / 2} y={y(c)} width={Math.max(1, xb - xa - gap)} height={M.top + ph - y(c)} />
        })}
        {curve.length > 1 && (
          <polyline className="kdb-plot-kde" points={curve.map(([cx, cy]) => `${x(cx).toFixed(1)},${y(cy).toFixed(1)}`).join(' ')} />
        )}
      </>
    )
  }, [hist, curve, lo, hi, pw, ph, yMax])

  const xTicks = niceTicks(lo, hi, Math.max(3, Math.round(pw / 90)))
  const xStep = xTicks.length > 1 ? Math.abs(xTicks[1] - xTicks[0]) : 1
  const yTicks = niceTicks(0, yMax, Math.max(3, Math.round(ph / 50))).filter((t) => t === Math.round(t) && t <= yMax)

  const local = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const inPlot = (x: number) => Math.min(M.left + pw, Math.max(M.left, x))
  const binAt = (x: number) => {
    const v = vOf(x)
    const k = Math.floor((v - hist.start) / hist.bin + 1e-7)
    return k >= 0 && k < hist.counts.length ? k : -1
  }

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const { x } = local(e)
    if (x < M.left || x > M.left + pw) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ x0: x, x1: x })
    setHover(null)
  }
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const { x, y } = local(e)
    if (drag) {
      setDrag({ ...drag, x1: inPlot(x) })
      return
    }
    const inside = x >= M.left && x <= M.left + pw && y >= M.top && y <= M.top + ph
    const k = inside ? binAt(x) : -1
    setHover(k >= 0 ? { x, y, k } : null)
  }
  const onUp = () => {
    if (!drag) return
    const a = vOf(drag.x0)
    const b = vOf(drag.x1)
    setDrag(null)
    if (Math.abs(drag.x1 - drag.x0) > 6 && Math.abs(a - b) >= 0.2) setZoom([Math.min(a, b), Math.max(a, b)])
  }

  const hoverCount = hover ? hist.counts[hover.k] : 0
  const hoverFrom = hover ? hist.start + hover.k * hist.bin : 0

  return (
    <div>
      <div className="kdb-plot-controls">
        <label title="Width of the histogram bars. Auto: about 60 bars across the range shown.">
          Bin width
          <select className="k-input" value={binPref} onChange={(e) => onBin(Number(e.target.value))}>
            <option value={0}>Auto ({bin.toFixed(1)} eV)</option>
            {BINS.map((b) => (
              <option key={b} value={b}>
                {b.toFixed(1)} eV
              </option>
            ))}
          </select>
        </label>
        <label title="A smooth curve over the bars (Gaussian kernel density, Silverman bandwidth)">
          <input type="checkbox" checked={smooth} onChange={(e) => onSmooth(e.target.checked)} />
          Smooth curve
        </label>
        <span className="kdb-spacer" />
        <button type="button" className="k-btn small" disabled={!zoom} onClick={() => setZoom(null)} title="Show the whole range (or double-click the plot)">
          <RotateCcw size={13} /> Reset zoom
        </button>
      </div>
      <p className="kdb-muted kdb-plot-caption">
        {title} · {values.length.toLocaleString()} entries{zoom ? `, ${shown.toLocaleString()} in view` : ''} · drag to zoom, double-click to reset
      </p>
      <div className="kdb-plot-box" ref={box}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Histogram of ${values.length} binding energies, ${fmt(hi, xStep)} to ${fmt(lo, xStep)} eV`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => setDrag(null)}
          onPointerLeave={() => !drag && setHover(null)}
          onDoubleClick={() => setZoom(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={M.left} y={M.top - 2} width={pw} height={ph + 2} />
            </clipPath>
          </defs>
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line className="kdb-plot-grid" x1={M.left} x2={M.left + pw} y1={yOf(t)} y2={yOf(t)} />
              <text className="kdb-plot-tick" x={M.left - 8} y={yOf(t)} textAnchor="end" dominantBaseline="middle">
                {t}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={`x${t}`}>
              <line className="kdb-plot-grid" x1={xOf(t)} x2={xOf(t)} y1={M.top} y2={M.top + ph} />
              <text className="kdb-plot-tick" x={xOf(t)} y={M.top + ph + 16} textAnchor="middle">
                {fmt(t, xStep)}
              </text>
            </g>
          ))}
          <g clipPath={`url(#${clipId})`}>
            {marks}
            {hover && hoverCount > 0 && (
              <rect
                className="kdb-plot-bar kdb-hot"
                x={xOf(hoverFrom + hist.bin)}
                y={yOf(hoverCount)}
                width={Math.max(1, xOf(hoverFrom) - xOf(hoverFrom + hist.bin))}
                height={M.top + ph - yOf(hoverCount)}
              />
            )}
          </g>
          <line className="kdb-plot-axis" x1={M.left} x2={M.left + pw} y1={M.top + ph} y2={M.top + ph} />
          <line className="kdb-plot-axis" x1={M.left} x2={M.left} y1={M.top} y2={M.top + ph} />
          <text className="kdb-plot-label" x={M.left + pw / 2} y={height - 6} textAnchor="middle">
            Binding energy (eV)
          </text>
          <text className="kdb-plot-label" transform={`translate(14 ${M.top + ph / 2}) rotate(-90)`} textAnchor="middle">
            Entries
          </text>
          {drag && Math.abs(drag.x1 - drag.x0) > 1 && (
            <rect className="kdb-plot-sel" x={Math.min(drag.x0, drag.x1)} y={M.top} width={Math.abs(drag.x1 - drag.x0)} height={ph} />
          )}
        </svg>
        {hover && hoverCount > 0 && (
          <div
            className="kdb-plot-tip"
            style={{ left: Math.min(hover.x + 12, width - 150), top: Math.max(4, hover.y - 40) }}
          >
            <b>{hoverCount}</b> {hoverCount === 1 ? 'entry' : 'entries'}
            <br />
            {fmt(hoverFrom, hist.bin)}–{fmt(hoverFrom + hist.bin, hist.bin)} eV
          </div>
        )}
      </div>
    </div>
  )
}
