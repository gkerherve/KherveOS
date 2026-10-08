// The output under the editor: what the code printed, the value, figures, the error and the checks.

import { Eraser } from 'lucide-react'
import { figureUrl } from '@/os/python/kernel'
import { summarizeChecks } from './checks.ts'
import type { RunReport, Seg } from './report.ts'

interface Props {
  running: boolean
  segs: Seg[]
  figures: string[]
  report: RunReport | null
  /** How many runs so far in this window ("In [3]"). */
  runNo: number
  onJump(line: number): void
  onClear(): void
  /** The code calls input(): show the box for its answers. */
  showInput: boolean
  answers: string
  onAnswers(text: string): void
  fontSize: number
}

const fmtTime = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`)

export function OutputPane(p: Props) {
  const { report } = p
  const empty = !p.running && !p.segs.length && !p.figures.length && !report
  const summary = report?.checks ? summarizeChecks(report.checks) : null

  return (
    <div className="kcd-output" aria-label="Output">
      <div className="kcd-out-head">
        <span className="kcd-out-title">Output</span>
        {p.runNo > 0 && (
          <span className="kcd-out-meta">
            [{p.runNo}] {p.running ? 'running…' : report ? fmtTime(report.ms) : ''}
          </span>
        )}
        <span className="k-spacer" />
        <button className="k-icon-btn" title="Clear the output" aria-label="Clear the output" onClick={p.onClear} disabled={empty}><Eraser size={14} /></button>
      </div>

      {p.showInput && (
        <div className="kcd-input">
          <label htmlFor="kcd-answers">
            <code>input()</code> cannot ask for a keystroke here. Its answers come from this box, one line per call:
          </label>
          <textarea id="kcd-answers" className="k-input" rows={2} value={p.answers} placeholder="Ada&#10;42" spellCheck={false} onChange={(e) => p.onAnswers(e.target.value)} />
        </div>
      )}

      <div className="kcd-out-body" style={{ fontSize: p.fontSize - 1 }}>
        {empty && <p className="kcd-empty">Run your code to see its output here. <span className="k-muted">Ctrl/Cmd+Enter runs, Shift+Ctrl/Cmd+Enter runs and checks.</span></p>}

        {p.segs.map((s, i) => (
          <pre key={i} className={`kcd-seg ${s.kind}`}>{s.text}</pre>
        ))}

        {report?.value != null && <pre className="kcd-value">{report.value}</pre>}

        {p.figures.map((f, i) => (
          <img key={i} className="kcd-fig" src={figureUrl(f)} alt={`Figure ${i + 1}`} />
        ))}

        {report?.error && (
          <div className="kcd-error" role="alert">
            <div className="kcd-error-head">
              <strong>{report.error.name}</strong>: {report.error.message}
              {report.error.line != null && (
                <button className="k-link-btn" onClick={() => p.onJump(report.error!.line!)}>line {report.error.line}</button>
              )}
            </div>
            {report.error.traceback && (
              <details>
                <summary>Full traceback</summary>
                <pre>{report.error.traceback}</pre>
              </details>
            )}
          </div>
        )}

        {report?.timedOut && <p className="kcd-note warn">Stopped: the code ran for more than 5 seconds. Is there a loop that never ends? Nothing else was affected.</p>}
        {report?.stopped && !report.timedOut && <p className="kcd-note">Stopped.{report.language === 'python' ? ' Python was restarted: its variables are gone.' : ''}</p>}

        {summary && report?.checks && (
          <div className={`kcd-result ${summary.allPassed ? 'ok' : 'fail'}`} role="status">
            <div className="kcd-result-head">{summary.headline}{summary.allPassed ? '' : report.checks.find((c) => !c.ok) ? ': keep going' : ''}</div>
            <ul>
              {report.checks.map((c, i) => (
                <li key={i} className={c.ok ? 'ok' : 'fail'}>
                  <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span> {c.label}
                  {!c.ok && c.detail && <em className="kcd-why"> — {c.detail}</em>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
