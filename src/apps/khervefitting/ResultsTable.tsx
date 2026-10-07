// The results table (the desktop's results_grid): the peaks exported from
// every core level of one sample, with their sensitivity factors and the
// atomic and weight percentages of the ticked rows. "Export" adds (or
// updates) the current core level's peaks.

import { useState } from 'react'
import { os } from '@/os'
import type { ResultRow } from './model'

export interface ResultsTableProps {
  rows: ResultRow[]
  tableKey: string
  onExport: () => void
  onToggle: (key: string, checked: boolean) => void
  onSet: (key: string, field: 'rsf' | 'txfn' | 'name', value: string) => void
  onDelete: (keys: string[] | null) => void
}

const f2 = (v: number | string) => (typeof v === 'number' ? v.toFixed(2) : v)

export function ResultsTable({ rows, tableKey, onExport, onToggle, onSet, onDelete }: ResultsTableProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const total = rows.filter((r) => r.checked).reduce((s, r) => s + r.at, 0)

  const editNumber = async (r: ResultRow, field: 'rsf' | 'txfn') => {
    const v = await os.dialog.prompt(`${field === 'rsf' ? 'Sensitivity factor (RSF)' : 'Transmission (TXFN)'} of ${r.name}:`, {
      title: 'Results', defaultValue: String(field === 'rsf' ? r.rsf : r.txfn),
    })
    if (v !== null && Number.isFinite(Number(v)) && Number(v) > 0) onSet(r.key, field, v)
  }

  const rename = async (r: ResultRow) => {
    const v = await os.dialog.prompt('Peak name in the results:', { title: 'Results', defaultValue: r.name })
    if (v) onSet(r.key, 'name', v)
  }

  return (
    <div className="kf-results">
      <div className="kf-results-bar">
        <span className="kf-results-title">Results — sample {tableKey.replace('Results Table', '') || '0'}</span>
        <span className="kf-grow" />
        <button className="k-btn" onClick={onExport} title="Add this core level's peaks to the table">
          Export
        </button>
        <button className="k-btn" disabled={!picked.size} onClick={() => { onDelete([...picked]); setPicked(new Set()) }}>
          Delete
        </button>
        <button className="k-btn" disabled={!rows.length} onClick={() => { onDelete(null); setPicked(new Set()) }}>
          Clear
        </button>
      </div>
      {rows.length ? (
        <div className="kf-table">
          <table>
            <thead>
              <tr>
                <th title="Counted in the atomic %">✓</th>
                <th>Peak</th>
                <th>Position</th>
                <th>Height</th>
                <th>FWHM</th>
                <th>L/G</th>
                <th>Area</th>
                <th className="kf-key">At. %</th>
                <th title="Relative sensitivity factor (double-click to change)">RSF</th>
                <th title="Transmission (double-click to change)">TXFN</th>
                <th title="Energy compensation (escape depth) correction">ECF</th>
                <th>Corr. Area</th>
                <th className="kf-key">Wt. %</th>
                <th>Model</th>
                <th>Sheet</th>
                <th>Instr.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className={picked.has(r.key) ? 'kf-sel' : ''}
                  onMouseDown={(e) => {
                    const next = new Set(e.metaKey || e.ctrlKey || e.shiftKey ? picked : [])
                    if (next.has(r.key) && (e.metaKey || e.ctrlKey)) next.delete(r.key)
                    else next.add(r.key)
                    setPicked(next)
                  }}
                >
                  <td>
                    <input type="checkbox" checked={r.checked} onChange={(e) => onToggle(r.key, e.target.checked)} />
                  </td>
                  <td onDoubleClick={() => void rename(r)}>{r.name}</td>
                  <td>{f2(r.position)}</td>
                  <td>{f2(r.height)}</td>
                  <td>{f2(r.fwhm)}</td>
                  <td>{f2(r.lg)}</td>
                  <td>{f2(r.area)}</td>
                  <td className="kf-key">{r.checked ? r.at.toFixed(2) : '0.00'}</td>
                  <td className="kf-editable" onDoubleClick={() => void editNumber(r, 'rsf')}>{f2(r.rsf)}</td>
                  <td className="kf-editable" onDoubleClick={() => void editNumber(r, 'txfn')}>{f2(r.txfn)}</td>
                  <td>{r.ecf}</td>
                  <td>{f2(r.relArea)}</td>
                  <td className="kf-key">{r.checked ? (r.wt ?? 0).toFixed(2) : '0.00'}</td>
                  <td>{r.model}</td>
                  <td>{r.sheet}</td>
                  <td>{r.instrument}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7}>Total of the ticked peaks</td>
                <td className="kf-key">{total.toFixed(2)}</td>
                <td colSpan={8} />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="kf-table kf-empty">Fit a core level, then <b>Export</b> its peaks here to get atomic percentages.</div>
      )}
    </div>
  )
}
