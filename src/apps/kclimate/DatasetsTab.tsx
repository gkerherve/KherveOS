// The dataset browser: the open datasets that ship with kClimate (with their metadata), the data the user imported,
// and the series that are loaded in this project.

import { useMemo, useState } from 'react'
import { ClipboardPaste, FileUp, LineChart, Trash2 } from 'lucide-react'
import type { Env } from './env'
import { yearSpan } from './series'
import { Card, EmptyState, Notice, fmt } from './ui'

const spanText = (first: number, last: number, step: string): string => {
  const y = (t: number) => Math.floor(t + 1e-9)
  return `${y(first)}–${y(last)}${step === 'monthly' ? ' (monthly)' : step === 'annual' ? ' (annual)' : ' (irregular)'}`
}

export default function DatasetsTab({ env }: { env: Env }) {
  const [filter, setFilter] = useState('')
  const { project, manifest } = env
  const f = filter.trim().toLowerCase()
  const shown = useMemo(
    () => (manifest?.datasets ?? []).filter((d) => !f || `${d.title} ${d.provider} ${d.description} ${d.columns.map((c) => c.name).join(' ')}`.toLowerCase().includes(f)),
    [manifest, f],
  )
  const loaded = env.lib.all()
  const plot = (ref: string) => {
    env.update((p) => { if (!p.series.lines.some((l) => l.ref === ref)) p.series.lines.push({ ref, axis: p.series.lines.length ? 'right' : 'left' }) })
    env.setTab('series')
  }
  return (
    <div className="cl-page">
      <div className="cl-page-head">
        <div>
          <h2>Datasets</h2>
          <p className="k-muted">Open climate data that come with kClimate, and your own. Tick a dataset to use it in this project; every analysis can then pick its series.</p>
        </div>
        <div className="cl-row">
          <button type="button" className="k-btn" onClick={() => env.openImport()}><FileUp size={14} /> Import CSV…</button>
          <button type="button" className="k-btn" onClick={() => env.openImport('')}><ClipboardPaste size={14} /> Paste CSV…</button>
        </div>
      </div>

      {env.manifestError && <Notice kind="error">{env.manifestError} The built-in datasets are not available right now; you can still import a CSV file of your own.</Notice>}

      <input className="k-input cl-search" type="search" placeholder="Search datasets: co2, temperature, ice…" aria-label="Search datasets" value={filter} onChange={(e) => setFilter(e.target.value)} />

      <div className="cl-cards">
        {shown.map((d) => {
          const on = project.datasets.includes(d.id)
          const st = env.status[d.id]
          return (
            <article key={d.id} className={`cl-dataset${on ? ' on' : ''}`}>
              <header>
                <label className="cl-check">
                  <input type="checkbox" checked={on} onChange={(e) => env.toggleDataset(d.id, e.target.checked)} aria-label={`Use ${d.title}`} />
                  <strong>{d.title}</strong>
                </label>
                {st === 'loading' && <span className="cl-badge">loading…</span>}
                {st === 'error' && <span className="cl-badge bad" title={env.errors[d.id]}>could not load</span>}
              </header>
              <p>{d.description}</p>
              <dl>
                <dt>Provider</dt><dd>{d.provider}</dd>
                <dt>Years</dt><dd>{spanText(d.t_first, d.t_last, d.step)}, {d.rows.toLocaleString()} rows</dd>
                <dt>Licence</dt><dd>{d.licence}</dd>
                <dt>Series</dt>
                <dd>{d.columns.map((c) => `${c.name}${c.unit ? ` (${c.unit})` : ''}`).join('; ')}</dd>
              </dl>
              {d.missing && <p className="cl-small k-muted">{d.missing}</p>}
            </article>
          )
        })}
        {manifest && shown.length === 0 && <EmptyState title="No dataset matches">Try another word, or import your own CSV.</EmptyState>}
        {!manifest && !env.manifestError && <p className="k-muted">Loading the catalog…</p>}
      </div>

      {project.imports.length > 0 && (
        <Card title="Your data">
          {project.imports.map((d) => (
            <div key={d.id} className="cl-import-row">
              <div>
                <strong>{d.name}</strong>{d.synthetic && <span className="cl-badge warn">synthetic</span>}
                <div className="cl-small k-muted">{d.step}, {d.t.length} rows, {d.columns.map((c) => c.name).join(', ')}</div>
              </div>
              <button type="button" className="k-icon-btn" title="Remove this dataset from the project" aria-label={`Remove ${d.name}`} onClick={() => env.removeImport(d.id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </Card>
      )}

      <Card title={`Series in this project (${loaded.length})`}>
        {loaded.length === 0 ? (
          <p className="k-muted">Nothing is loaded yet. Tick a dataset above.</p>
        ) : (
          <div className="cl-tablewrap">
            <table className="cl-table">
              <thead><tr><th>Series</th><th>Unit</th><th>Years</th><th>Values</th><th /></tr></thead>
              <tbody>
                {loaded.map((s) => {
                  const y = yearSpan(s)
                  return (
                    <tr key={s.id}>
                      <td><code className="cl-code">{s.id}</code> {s.name}{s.synthetic && <span className="cl-badge warn">synthetic</span>}</td>
                      <td>{s.unit || '–'}</td>
                      <td>{y ? `${y[0]}–${y[1]}` : '–'}</td>
                      <td>{fmt(s.y.filter(Number.isFinite).length, 6)} {s.step}</td>
                      <td><button type="button" className="k-btn small" onClick={() => plot(s.id)}><LineChart size={12} /> Plot</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
