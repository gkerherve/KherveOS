// Tools > Manage libraries: search and install Arduino libraries on the server (arduino-cli).

import { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { os } from '@/os'
import { installLibrary, listLibraries, searchLibraries, type LibraryInfo } from './toolchain'

interface Props {
  /** Libraries the open sketch needs (from the example), offered first. */
  needed: string[]
  /** Setting a new seed runs a search for it. */
  seed: { query: string; n: number }
}

export function Libraries({ needed, seed }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LibraryInfo[] | null>(null)
  const [installed, setInstalled] = useState<LibraryInfo[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const r = await listLibraries()
    setInstalled(r.libraries)
    if (r.cli === false) setMessage('arduino-cli is not installed on the KherveOS server: libraries cannot be managed from here.')
    else if (r.output) setMessage(r.output)
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return
    setBusy('search')
    setMessage(null)
    const r = await searchLibraries(q.trim())
    setBusy(null)
    setResults(r.libraries)
    if (r.output) setMessage(r.output)
    else if (!r.libraries.length) setMessage('No library found.')
  }, [])

  useEffect(() => {
    if (seed.n === 0 || !seed.query) return
    setQuery(seed.query)
    void search(seed.query)
  }, [seed, search])

  const install = async (name: string) => {
    if (!(await os.dialog.confirm(`Install the library “${name}” on the KherveOS server? It becomes available to every user of this server.`, { title: 'Install library', okLabel: 'Install' }))) return
    setBusy(name)
    const r = await installLibrary(name)
    setBusy(null)
    setMessage(r.ok ? `Installed ${name}.` : r.output)
    void refresh()
  }

  const have = new Set(installed.map((l) => l.name.toLowerCase()))
  return (
    <div className="ka-libs">
      <form className="ka-row" onSubmit={(e) => { e.preventDefault(); void search(query) }}>
        <input className="k-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search libraries" aria-label="Search libraries" />
        <button className="k-icon-btn" aria-label="Search" disabled={busy === 'search'}><Search size={13} /></button>
      </form>
      {message && <div className="ka-note">{message}</div>}
      {needed.length > 0 && (
        <div className="ka-libgroup">
          <div className="ka-subtitle">This sketch needs</div>
          {needed.map((n) => (
            <div key={n} className="ka-lib">
              <span className="ka-lib-name">{n}</span>
              {have.has(n.toLowerCase()) ? <span className="k-muted">installed</span> : <button className="k-btn small" disabled={busy !== null} onClick={() => void install(n)}>{busy === n ? '…' : 'Install'}</button>}
            </div>
          ))}
        </div>
      )}
      {results && (
        <div className="ka-libgroup">
          <div className="ka-subtitle">Results</div>
          {results.map((l) => (
            <div key={l.name} className="ka-lib" title={l.sentence}>
              <span className="ka-lib-name">{l.name}<span className="k-muted"> {l.version}</span><span className="ka-lib-sentence k-muted">{l.sentence}</span></span>
              {have.has(l.name.toLowerCase()) ? <span className="k-muted">installed</span> : <button className="k-btn small" disabled={busy !== null} onClick={() => void install(l.name)}>{busy === l.name ? '…' : 'Install'}</button>}
            </div>
          ))}
        </div>
      )}
      <div className="ka-libgroup">
        <div className="ka-subtitle">Installed on the server ({installed.length})</div>
        {installed.map((l) => (
          <div key={l.name} className="ka-lib"><span className="ka-lib-name">{l.name}<span className="k-muted"> {l.version}</span></span></div>
        ))}
        {!installed.length && <div className="k-muted">None listed.</div>}
      </div>
    </div>
  )
}
