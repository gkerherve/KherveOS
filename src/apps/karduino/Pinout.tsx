// A small SVG pinout of the Uno / Nano and the Mega 2560 with the pins a sketch uses lit.

import { pinoutOf, ROLE_NAMES, type PinReport } from './pins'
import type { Family } from './boards'

const CELL_W = 34
const CELL_H = 38
const GAP = 3
const PER_ROW = 16

export function Pinout({ family, report }: { family: Family; report: PinReport }) {
  const groups = pinoutOf(family)
  if (!groups.length) return <div className="k-muted ka-pinout-none">No pin drawing for this board: the pins found in the code are listed below.</div>
  const used = new Map(report.pins.map((p) => [p.pin, p]))
  let y = 4
  const out = groups.map((g) => {
    const top = y
    const rows = Math.ceil(g.pins.length / PER_ROW)
    y += 14 + rows * (CELL_H + GAP) + 6
    return { g, top }
  })
  const width = PER_ROW * (CELL_W + GAP) + 4
  return (
    <svg className="ka-pinout" viewBox={`0 0 ${width} ${y}`} role="img" aria-label="Board pinout">
      {out.map(({ g, top }) => (
        <g key={g.title}>
          <text x={4} y={top + 9} className="ka-pin-title">{g.title}</text>
          {g.pins.map((p, i) => {
            const cx = 2 + (i % PER_ROW) * (CELL_W + GAP)
            const cy = top + 14 + Math.floor(i / PER_ROW) * (CELL_H + GAP)
            const u = used.get(p.id)
            const tags = [...(p.pwm ? ['~'] : []), ...p.tags.filter((t) => t !== 'PWM')].join(' ')
            return (
              <g key={p.id} className={`ka-pin${u ? ' used' : ''}${u?.roles.length === 1 && u.roles[0] === 'bus' ? ' bus' : ''}`}>
                <title>
                  {p.id}
                  {p.tags.length ? ` (${p.tags.join(', ')})` : ''}
                  {u ? ` — ${u.roles.map((r) => ROLE_NAMES[r]).join(', ')}, line ${u.lines.join(', ')}` : ''}
                </title>
                <rect x={cx} y={cy} width={CELL_W} height={CELL_H} rx={4} />
                <text x={cx + CELL_W / 2} y={cy + 16} textAnchor="middle" className="ka-pin-num">{p.label}</text>
                <text x={cx + CELL_W / 2} y={cy + 29} textAnchor="middle" className="ka-pin-tag">{tags}</text>
              </g>
            )
          })}
        </g>
      ))}
    </svg>
  )
}
