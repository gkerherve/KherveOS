// QTableWidget (the Variables sheet, a polygon's Points, rows editors…) and
// QListWidget. Cells edit on double-click (or typing on the current cell);
// cell widgets (the Variables sheet's sliders and drop-downs) are widgets.

import { memo, useState } from 'react'
import { MdiIcon } from '../MdiIcon'
import type { ListRow, Node, TableCell } from '../types'
import { useQt } from './context'
import { QtNode, tipAttr } from './QtNode'

export const QtTable = memo(function QtTable({ n }: { n: Node }) {
  const { send } = useQt()
  const rows = (n.rows as number | undefined) ?? 0
  const cols = n.cols ?? 0
  const cells = new Map<string, TableCell>()
  for (const [r, c, cell] of n.cells ?? []) cells.set(`${r},${c}`, cell)
  const widgets = new Map<string, Node>()
  for (const [r, c, w] of n.widgets ?? []) widgets.set(`${r},${c}`, w)
  const cur = (n.cur as [number, number] | undefined) ?? [-1, -1]
  const [edit, setEdit] = useState<{ r: number; c: number; text: string } | null>(null)
  const commit = () => {
    if (edit) send({ op: 'edit', id: n.id, r: edit.r, c: edit.c, text: edit.text })
    setEdit(null)
  }
  const widths = n.cw ?? {}
  return (
    <div className="kc-table-wrap">
      <table className="kc-table">
        {n.hl && (
          <thead>
            <tr>
              {!n.novh && <th className="kc-table-corner" />}
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} style={{ width: widths[String(c)] }}>
                  {n.hl?.[c] ?? ''}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {!n.novh && <th className="kc-table-rowhead">{n.vl?.[r] ?? r + 1}</th>}
              {Array.from({ length: cols }, (_, c) => {
                const key = `${r},${c}`
                const w = widgets.get(key)
                const cell = cells.get(key)
                const isCur = cur[0] === r && cur[1] === c
                if (w)
                  return (
                    <td key={c} className="kc-table-widget">
                      <QtNode n={w} />
                    </td>
                  )
                if (edit && edit.r === r && edit.c === c)
                  return (
                    <td key={c} className="editing">
                      <input
                        className="k-input"
                        autoFocus
                        value={edit.text}
                        onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                        onBlur={commit}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter') commit()
                          if (e.key === 'Escape') setEdit(null)
                        }}
                      />
                    </td>
                  )
                return (
                  <td
                    key={c}
                    className={`${isCur ? 'current' : ''}${cell?.sel ? ' selected' : ''}`}
                    style={{ color: cell?.fg, background: cell?.bg, fontStyle: cell?.it ? 'italic' : undefined, fontWeight: cell?.b ? 600 : undefined }}
                    {...tipAttr(cell?.tip)}
                    onClick={() => send({ op: 'cur', id: n.id, r, c })}
                    onDoubleClick={() => {
                      send({ op: 'dbl', id: n.id, r, c })
                      if (!cell?.ro) setEdit({ r, c, text: cell?.text ?? '' })
                    }}
                  >
                    {cell?.text ?? ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

export const QtList = memo(function QtList({ n }: { n: Node }) {
  const { send } = useQt()
  const items = (n.items ?? []) as ListRow[]
  const sel = items.map((it, i) => (it.sel ? i : -1)).filter((i) => i >= 0)
  return (
    <div className="kc-list" tabIndex={0}>
      {items.map((it, i) =>
        it.hid ? null : (
          <div
            key={i}
            className={`kc-list-row${it.sel ? ' selected' : ''}${it.dis ? ' disabled' : ''}`}
            style={{ color: it.fg }}
            {...tipAttr(it.tip)}
            onClick={(e) => {
              if (it.dis) return
              const rows = n.multi && (e.ctrlKey || e.metaKey) ? (sel.includes(i) ? sel.filter((s) => s !== i) : [...sel, i]) : [i]
              send({ op: 'select', id: n.id, rows })
            }}
            onDoubleClick={() => !it.dis && send({ op: 'dbl', id: n.id, row: i })}
          >
            {it.cs !== undefined && (
              <input type="checkbox" checked={it.cs === 2} onChange={(e) => send({ op: 'check', id: n.id, row: i, state: e.target.checked ? 2 : 0 })} />
            )}
            {it.icon && <MdiIcon name={it.icon} size={16} />}
            <span>{it.text}</span>
          </div>
        ),
      )}
    </div>
  )
})
