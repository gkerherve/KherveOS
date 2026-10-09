// The audit log and Verify notebook. The log is append-only and chained by SHA-256; Verify recomputes the chain and
// every signed hash and names the record that does not match.

import { useMemo, useState } from 'react'
import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { reportSummary, type VerifyReport } from './audit'
import { HONESTY_NOTE } from './render'
import type { Notebook } from './model'
import { stamp } from './ui'

interface Props {
  nb: Notebook
  report: VerifyReport | null
  verifying: boolean
  onVerify(): void
  onOpenEntry(id: string): void
  focusEntry: string | null
}

export function AuditView({ nb, report, verifying, onVerify, onOpenEntry, focusEntry }: Props) {
  const [onlyEntry, setOnlyEntry] = useState(focusEntry)
  const bad = useMemo(() => new Set((report?.issues ?? []).flatMap((i) => (i.seq != null ? [i.seq] : []))), [report])
  const rows = nb.audit.filter((r) => !onlyEntry || r.entryId === onlyEntry)
  return (
    <div className="ln-audit">
      <div className="ln-audit-head">
        <button className="k-btn primary" onClick={onVerify} disabled={verifying}><ShieldCheck size={14} /> {verifying ? 'Verifying…' : 'Verify notebook'}</button>
        {onlyEntry && <button className="k-btn small" onClick={() => setOnlyEntry(null)}>Show every record</button>}
        <span className="k-muted ln-hint">{nb.audit.length} records, each includes the SHA-256 of the one before.</span>
      </div>
      <p className="ln-honest">{HONESTY_NOTE}</p>
      {report && (
        <div className={`ln-report ${report.ok ? 'ok' : 'bad'}`} role="status">
          {report.ok ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
          <div>
            <b>{report.ok ? 'Verified' : 'Verification failed'}</b>: {reportSummary(report)}
            {!report.ok && (
              <ul>
                {report.issues.map((i, k) => (
                  <li key={k}>{i.seq != null && <b>Record {i.seq}: </b>}{i.message}{i.entryId && nb.entries.some((e) => e.id === i.entryId) && <> <button className="ln-linkbtn" onClick={() => onOpenEntry(i.entryId)}>open the entry</button></>}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="ln-scroll-y">
        <table className="ln-grid ln-audit-table">
          <thead><tr><th>#</th><th>Time (UTC)</th><th>User</th><th>Action</th><th>Entry</th><th>Content hash</th><th>Record hash</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seq} className={bad.has(r.seq) ? 'bad' : ''} aria-label={bad.has(r.seq) ? `Record ${r.seq} does not verify` : undefined}>
                <td>{r.seq}</td><td>{stamp(r.time)}</td><td>{r.user}</td>
                <td title={r.detail}>{r.action.replace(/^entry-/, '')}</td>
                <td>{nb.entries.some((e) => e.id === r.entryId) ? <button className="ln-linkbtn" onClick={() => onOpenEntry(r.entryId)}>{r.number}</button> : r.number}</td>
                <td className="ln-hash" title={r.hash}>{r.hash.slice(0, 12)}</td><td className="ln-hash" title={r.rec}>{r.rec.slice(0, 12)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
