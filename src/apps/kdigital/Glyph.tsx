// Draws a part's symbol (React): used by the canvas, the palette and the properties panel.

import type { ReactElement } from 'react'
import { KIND_DEFS, type Part, type Prim } from './model'
import { partPrims } from './display'
import type { Simulator } from './sim'

export function primElement(pr: Prim, part: Pick<Part, 'rot' | 'mirror'>, key: number): ReactElement {
  const cls = pr.cls ? `dg-${pr.cls.split(' ').join(' dg-')}` : undefined
  if (pr.t === 'path') return <path key={key} d={pr.d} className={cls} fill={pr.fill ? 'currentColor' : 'none'} strokeWidth={pr.width} />
  if (pr.t === 'circle') return <circle key={key} cx={pr.cx} cy={pr.cy} r={pr.r} className={cls} fill={pr.fill ? 'currentColor' : 'none'} />
  // text stays upright whatever the part's rotation
  return (
    <text
      key={key} transform={`translate(${pr.x} ${pr.y}) scale(${part.mirror ? -1 : 1} 1) rotate(${-part.rot})`} fontSize={pr.size ?? 11} textAnchor={pr.anchor ?? 'middle'}
      fill="currentColor" stroke="none" className={`dg-sym-text${cls ? ` ${cls}` : ''}`} fontWeight={pr.bold ? 700 : undefined}
    >
      {pr.s}
    </text>
  )
}

export function PartGlyph({ part, sim = null }: { part: Part; sim?: Simulator | null }) {
  const prims = partPrims(part, sim)
  return (
    <g transform={`translate(${part.x} ${part.y}) rotate(${part.rot}) scale(${part.mirror ? -1 : 1} 1)`}>
      {prims.map((p, i) => primElement(p, part, i))}
    </g>
  )
}

/** A small standalone preview of a part kind (palette entries). */
export function PartIcon({ part, size = 44 }: { part: Part; size?: number }) {
  const [x1, y1, x2, y2] = KIND_DEFS[part.kind].shape(part).box
  const pad = 14
  const w = x2 - x1 + 2 * pad
  const h = y2 - y1 + 2 * pad
  const preview: Part = { ...part, x: 0, y: 0, rot: 0, mirror: false }
  return (
    <svg className="dg-icon" width={size} height={Math.min(size * 1.4, (size * h) / w)} viewBox={`${x1 - pad} ${y1 - pad} ${w} ${h}`} aria-hidden>
      <PartGlyph part={preview} />
    </svg>
  )
}
