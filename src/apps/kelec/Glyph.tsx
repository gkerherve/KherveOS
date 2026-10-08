// Draws a part's symbol (React): used by the canvas, the palette and the properties panel.

import type { ReactElement } from 'react'
import { defOf, type Part, type Prim } from './model'

export function primElement(pr: Prim, part: Pick<Part, 'rot' | 'mirror'>, key: number): ReactElement {
  if (pr.t === 'path') return <path key={key} d={pr.d} fill={pr.fill ? 'currentColor' : 'none'} />
  if (pr.t === 'circle') return <circle key={key} cx={pr.cx} cy={pr.cy} r={pr.r} fill={pr.fill ? 'currentColor' : 'none'} />
  // text stays upright whatever the part's rotation
  return (
    <text
      key={key} transform={`translate(${pr.x} ${pr.y}) scale(${part.mirror ? -1 : 1} 1) rotate(${-part.rot})`} fontSize={pr.size ?? 11} textAnchor={pr.anchor ?? 'middle'}
      fill="currentColor" stroke="none" className="ke-sym-text"
    >
      {pr.s}
    </text>
  )
}

export function PartGlyph({ part }: { part: Part }) {
  const prims = defOf(part).draw(part)
  return (
    <g transform={`translate(${part.x} ${part.y}) rotate(${part.rot}) scale(${part.mirror ? -1 : 1} 1)`}>
      {prims.map((p, i) => primElement(p, part, i))}
    </g>
  )
}

/** A small standalone preview of a part kind (palette entries). */
export function PartIcon({ part, size = 44 }: { part: Part; size?: number }) {
  const def = defOf(part)
  const [x1, y1, x2, y2] = def.box
  const pad = 6
  const w = x2 - x1 + 2 * pad
  const h = y2 - y1 + 2 * pad
  const preview: Part = { ...part, x: 0, y: 0, rot: 0, mirror: false }
  return (
    <svg className="ke-icon" width={size} height={Math.min(size, (size * h) / w)} viewBox={`${x1 - pad} ${y1 - pad} ${w} ${h}`} aria-hidden>
      <PartGlyph part={preview} />
    </svg>
  )
}
