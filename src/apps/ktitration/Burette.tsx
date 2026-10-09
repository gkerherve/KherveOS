// The virtual burette and flask: the level falls as titrant is added, a drop falls on every addition, the
// solution in the flask has the colour of the chosen indicator, and a precipitate clouds it. Pure drawing
// (SVG); the numbers come from the titration result.

import { useId, useMemo } from 'react'

export interface BuretteProps {
  /** Titrant added (mL). */
  V: number
  /** Scale of the burette (mL): 25, 50 or 100. */
  capacity: number
  /** Volume of the flask before titrating, and the largest volume shown (mL), to scale the liquid level. */
  flaskV: number
  maxV: number
  /** Colour of the solution (hex) and how cloudy it is (0–1). */
  color: string
  cloud: number
  /** Changes on every addition: replays the falling drop. */
  dropKey: number
  /** Whether a drop is falling now. */
  dropping: boolean
  /** Text for assistive technology. */
  description: string
}

/** The smallest standard burette that holds `vmax`. */
export function buretteCapacity(vmax: number): number {
  return vmax <= 25 ? 25 : vmax <= 50 ? 50 : vmax <= 100 ? 100 : 250
}

export function Burette({ V, capacity, flaskV, maxV, color, cloud, dropKey, dropping, description }: BuretteProps) {
  const clip = useId()
  const top = 26
  const bottom = 206
  const scale = (bottom - top) / capacity
  const level = top + Math.min(V, capacity) * scale
  const major = capacity <= 25 ? 5 : capacity <= 50 ? 10 : 20
  const minor = major / 5
  const ticks = useMemo(() => {
    const out: Array<{ y: number; major: boolean; label: string }> = []
    for (let v = 0; v <= capacity + 1e-9; v += minor) {
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-9
      out.push({ y: top + v * scale, major: isMajor, label: isMajor ? String(Math.round(v)) : '' })
    }
    return out
  }, [capacity, minor, major, scale])
  // flask liquid: fills 28–88 % of the body height as the volume grows from its start to the largest
  const bodyH = 78
  const frac = maxV + flaskV > 0 ? Math.min(1, (flaskV + V) / (flaskV + maxV)) : 0.5
  const liquidH = bodyH * (0.35 + 0.6 * frac)
  const flaskBottom = 388
  return (
    <svg className="ti-burette" viewBox="0 0 220 410" role="img" aria-label={description} preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id={clip}>
          <path d="M96 300 L96 322 L52 380 Q46 390 58 390 L162 390 Q174 390 168 380 L124 322 L124 300 Z" />
        </clipPath>
      </defs>
      {/* burette tube */}
      <rect x="96" y={top - 8} width="28" height={bottom - top + 14} rx="3" className="ti-glass" />
      <rect x="97.5" y={level} width="25" height={bottom + 6 - level} className="ti-titrant" />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={t.major ? 96 : 96} x2={t.major ? 112 : 106} y1={t.y} y2={t.y} className={t.major ? 'ti-tick major' : 'ti-tick'} />
          {t.label && <text x="90" y={t.y + 3.5} textAnchor="end" className="ti-ticklabel">{t.label}</text>}
        </g>
      ))}
      <line x1="94" x2="126" y1={level} y2={level} className="ti-meniscus" />
      {/* stopcock and tip */}
      <rect x="104" y={bottom + 6} width="12" height="10" className="ti-stopcock" />
      <rect x="116" y={bottom + 9} width="22" height="4" rx="2" className="ti-stopcock-handle" />
      <path d="M104 216 L104 232 L110 246 L116 232 L116 216 Z" className="ti-glass tip" />
      {dropping && <circle key={dropKey} cx="110" cy="250" r="3.4" className="ti-drop" />}
      {/* flask */}
      <path d="M96 300 L96 322 L52 380 Q46 390 58 390 L162 390 Q174 390 168 380 L124 322 L124 300 Z" className="ti-flask-glass" />
      <g clipPath={`url(#${clip})`}>
        <rect x="40" y={flaskBottom - liquidH} width="140" height={liquidH + 6} style={{ fill: color }} className="ti-liquid" />
        {cloud > 0.01 && (
          <g className="ti-cloud" style={{ opacity: Math.min(0.85, cloud * 0.9) }}>
            <rect x="40" y={flaskBottom - liquidH} width="140" height={liquidH + 6} />
            {Array.from({ length: 14 }, (_, i) => <circle key={i} cx={60 + ((i * 37) % 100)} cy={flaskBottom - liquidH + 8 + ((i * 23) % Math.max(10, liquidH - 12))} r={1.4 + (i % 3) * 0.6} />)}
          </g>
        )}
        <rect x="100" y="381" width="20" height="5" rx="2.5" className="ti-stirbar" />
      </g>
      <path d="M96 300 L96 322 L52 380 Q46 390 58 390 L162 390 Q174 390 168 380 L124 322 L124 300" className="ti-flask-outline" />
      <line x1="92" x2="128" y1="300" y2="300" className="ti-flask-rim" />
    </svg>
  )
}
