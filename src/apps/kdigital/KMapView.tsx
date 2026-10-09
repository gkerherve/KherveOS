// A Karnaugh map as SVG: Gray-coded axes, the cells (click to cycle 0 → 1 → X), the groups of the chosen cover
// drawn as rounded rectangles (open on the side where a group wraps around the edge), five variables as two layers.

import { useMemo } from 'react'
import { kmapCells, type GroupRect, type KmapGroup } from './kmap'
import type { Cell } from './truth'

interface Props {
  vars: readonly string[]
  values: readonly Cell[]
  groups: readonly KmapGroup[]
  hover: number | null
  onCell(minterm: number): void
}

const CELL = 46
const AXIS = 34

function outline(r: GroupRect, x: number, y: number, w: number, h: number): string {
  // a path around the rectangle that leaves the open sides out
  const x2 = x + w, y2 = y + h
  const parts: string[] = []
  const side = (open: boolean, from: [number, number], to: [number, number]) => { if (!open) parts.push(`M${from[0]} ${from[1]} L${to[0]} ${to[1]}`); else parts.push(`M${from[0]} ${from[1]} M${to[0]} ${to[1]}`) }
  side(r.openTop, [x, y], [x2, y])
  side(r.openRight, [x2, y], [x2, y2])
  side(r.openBottom, [x2, y2], [x, y2])
  side(r.openLeft, [x, y2], [x, y])
  return parts.join(' ')
}

export function KMap({ vars, values, groups, hover, onCell }: Props) {
  const data = useMemo(() => kmapCells(vars, values), [vars, values])
  const { layout, cells } = data
  const layerW = AXIS + layout.cols * CELL + 16
  const layerH = AXIS + layout.rows * CELL + 28
  const width = layout.layers * layerW + 8
  const height = layerH + 10
  return (
    <svg className="dg-kmap" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Karnaugh map">
      {cells.map((grid, layer) => {
        const ox = 4 + layer * layerW
        const oy = 22
        return (
          <g key={layer} transform={`translate(${ox} ${oy})`}>
            {layout.layers > 1 && <text x={AXIS + (layout.cols * CELL) / 2} y={-8} textAnchor="middle" className="dg-km-layer">{layout.layerVars[0]} = {layer}</text>}
            <text x={AXIS - 8} y={AXIS - 22} textAnchor="end" className="dg-km-vars">{layout.rowVars.join('')}\{layout.colVars.join('')}</text>
            {layout.colLabels.map((l, c) => <text key={c} x={AXIS + c * CELL + CELL / 2} y={AXIS - 8} textAnchor="middle" className="dg-km-axis">{l}</text>)}
            {layout.rowLabels.map((l, r) => <text key={r} x={AXIS - 6} y={AXIS + r * CELL + CELL / 2 + 4} textAnchor="end" className="dg-km-axis">{l}</text>)}
            {grid.map((row, r) => row.map((cell, c) => (
              <g key={`${r}-${c}`} className="dg-km-cell" onClick={() => onCell(cell.m)} role="button" aria-label={`Minterm ${cell.m}: ${cell.v === 2 ? 'don\'t care' : cell.v}`}>
                <rect x={AXIS + c * CELL} y={AXIS + r * CELL} width={CELL} height={CELL} className={`dg-km-box v${cell.v}`} />
                <text x={AXIS + c * CELL + CELL / 2} y={AXIS + r * CELL + CELL / 2 + 6} textAnchor="middle" className={`dg-km-value v${cell.v}`}>{cell.v === 2 ? 'X' : cell.v}</text>
                <text x={AXIS + c * CELL + 4} y={AXIS + r * CELL + 11} className="dg-km-index">{cell.m}</text>
              </g>
            )))}
            {groups.map((g, gi) => g.rects.filter((rc) => rc.layer === layer).map((rc, k) => {
              const inset = 3 + (gi % 3) * 2.5
              const x = AXIS + rc.c0 * CELL + inset
              const y = AXIS + rc.r0 * CELL + inset
              const w = (rc.c1 - rc.c0 + 1) * CELL - 2 * inset
              const h = (rc.r1 - rc.r0 + 1) * CELL - 2 * inset
              const cls = `dg-km-group dg-g${gi % 6}${hover === gi ? ' hot' : ''}`
              return (
                <g key={`${gi}-${k}`} className={cls} pointerEvents="none">
                  <rect x={x} y={y} width={w} height={h} rx={9} className="dg-km-fill" />
                  {rc.openTop || rc.openBottom || rc.openLeft || rc.openRight
                    ? <path d={outline(rc, x, y, w, h)} className="dg-km-line" />
                    : <rect x={x} y={y} width={w} height={h} rx={9} className="dg-km-line" />}
                </g>
              )
            }))}
          </g>
        )
      })}
    </svg>
  )
}
