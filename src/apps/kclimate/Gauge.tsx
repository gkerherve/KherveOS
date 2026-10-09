// A half-circle gauge ("how far above pre-industrial are we") drawn in SVG with the theme's colours.

export interface GaugeZone {
  from: number
  to: number
  /** A theme variable: "--k-success", "--k-warning", "--k-danger". */
  color: string
}

interface Props {
  value: number
  min: number
  max: number
  zones: GaugeZone[]
  ticks: Array<{ value: number; label: string }>
  /** Big text in the middle. */
  center: string
  caption: string
  label: string
}

const CX = 110
const CY = 104
const R = 84

const point = (f: number, r = R): [number, number] => {
  const a = Math.PI * (1 - f)
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)]
}

const arc = (f0: number, f1: number, r = R): string => {
  const [x0, y0] = point(f0, r)
  const [x1, y1] = point(f1, r)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

export default function Gauge({ value, min, max, zones, ticks, center, caption, label }: Props) {
  const f = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)))
  const [nx, ny] = point(f(value), R - 10)
  return (
    <figure className="cl-gauge" aria-label={`${label}: ${center}`}>
      <svg viewBox="0 0 220 128" role="img" aria-hidden="true">
        <path d={arc(0, 1)} className="cl-gauge-track" strokeWidth={14} fill="none" strokeLinecap="butt" />
        {zones.map((z) => <path key={z.color + z.from} d={arc(f(z.from), f(z.to))} stroke={`var(${z.color})`} strokeWidth={14} fill="none" opacity={0.85} />)}
        {ticks.map((t) => {
          const [x0, y0] = point(f(t.value), R - 10)
          const [x1, y1] = point(f(t.value), R + 10)
          const [tx, ty] = point(f(t.value), R + 20)
          return (
            <g key={t.value}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} className="cl-gauge-tick" />
              <text x={tx} y={ty} className="cl-gauge-text" textAnchor="middle" dominantBaseline="middle">{t.label}</text>
            </g>
          )
        })}
        <line x1={CX} y1={CY} x2={nx} y2={ny} className="cl-gauge-needle" />
        <circle cx={CX} cy={CY} r={5} className="cl-gauge-hub" />
      </svg>
      <figcaption>
        <strong>{center}</strong>
        <span className="k-muted">{caption}</span>
      </figcaption>
    </figure>
  )
}
