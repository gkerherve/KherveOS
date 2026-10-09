// The data sources: for every dataset that ships with kClimate, its provider, URL, licence or terms, version and the date
// it was retrieved, and what was looked for and left out.

import { ExternalLink } from 'lucide-react'
import { os } from '@/os'
import type { Env } from './env'
import { Card, EmptyState, Notice } from './ui'

export default function SourcesTab({ env }: { env: Env }) {
  const { manifest } = env
  const open = (url: string) => { try { os.openUrl(url) } catch { /* no browser app */ } }
  return (
    <div className="cl-page">
      <div className="cl-page-head">
        <div>
          <h2>Data sources</h2>
          <p className="k-muted">
            Every number in the built-in datasets was downloaded from the provider named below and converted to CSV by <code className="cl-code">tools/fetch_kclimate_data.py</code>; none was typed in or estimated.
            Please credit the providers when you use the data. Data you import yourself are yours and are stored in the project file.
          </p>
        </div>
      </div>
      {env.manifestError && <Notice kind="error">{env.manifestError}</Notice>}
      {!manifest && !env.manifestError && <p className="k-muted">Loading the catalog…</p>}
      {manifest?.datasets.map((d) => (
        <Card key={d.id} title={d.title}>
          <dl className="cl-meta">
            <dt>Provider</dt><dd>{d.provider}</dd>
            <dt>URL</dt><dd><button type="button" className="k-link-btn" onClick={() => open(d.url)}>{d.url} <ExternalLink size={11} /></button></dd>
            <dt>Licence / terms</dt><dd>{d.licence}</dd>
            <dt>Version</dt><dd>{d.version}</dd>
            <dt>Retrieved</dt><dd>{d.retrieved}</dd>
            <dt>File</dt><dd><code className="cl-code">public/data/kclimate/{d.file}</code>, {d.rows.toLocaleString()} rows, {Math.floor(d.t_first + 1e-9)}–{Math.floor(d.t_last + 1e-9)}, {d.step}</dd>
            <dt>Cite as</dt><dd>{d.citation}</dd>
            {d.missing && <><dt>Missing values</dt><dd>{d.missing}</dd></>}
            {d.note && <><dt>Note</dt><dd>{d.note}</dd></>}
          </dl>
        </Card>
      ))}
      {manifest && manifest.not_included.length > 0 && (
        <Card title="Looked for, but not included">
          <ul className="cl-list">{manifest.not_included.map((n) => <li key={n}>{n}</li>)}</ul>
          <p className="k-muted cl-small">You can import any CSV time series yourself with File › Import CSV…</p>
        </Card>
      )}
      {manifest && manifest.datasets.length === 0 && <EmptyState title="The catalog is empty">Run tools/fetch_kclimate_data.py to download the datasets.</EmptyState>}
    </div>
  )
}
