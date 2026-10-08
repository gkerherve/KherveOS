// Under the editor: compile problems (click to jump), the size bars and the raw output.

import { useState } from 'react'
import { AlertTriangle, CircleX, Info } from 'lucide-react'
import { errorCount, formatBytes, sizeBars, warningCount, type CompileResult, type Diagnostic } from './build'

interface Props {
  result: CompileResult | null
  busy: string | null
  onJump(d: Diagnostic): void
}

export function Problems({ result, busy, onJump }: Props) {
  const [tab, setTab] = useState<'problems' | 'output'>('problems')
  if (!result && !busy) return null
  const diags = result?.diagnostics ?? []
  const bars = sizeBars(result?.size ?? null)
  return (
    <section className="ka-problems" aria-label="Compiler">
      <div className="ka-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'problems'} className={tab === 'problems' ? 'on' : ''} onClick={() => setTab('problems')}>
          Problems{result ? ` (${errorCount(diags)} errors, ${warningCount(diags)} warnings)` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'output'} className={tab === 'output' ? 'on' : ''} onClick={() => setTab('output')}>Output</button>
        <span className={`ka-verdict ${busy ? '' : result?.ok ? 'ok' : 'bad'}`}>
          {busy ? (busy === 'upload' ? 'Uploading…' : 'Compiling…') : result?.uploaded ? 'Uploaded' : result?.ok ? 'Compiled' : 'Failed'}
        </span>
      </div>
      {result && bars.length > 0 && (
        <div className="ka-sizes">
          {bars.map((b) => (
            <div key={b.label} className="ka-size" title={b.max ? `${b.used} of ${b.max} bytes` : `${b.used} bytes`}>
              <span className="ka-size-label">{b.label}</span>
              <span className="ka-bar"><span className={`ka-fill${b.percent !== null && b.percent > 90 ? ' high' : b.percent !== null && b.percent > 70 ? ' mid' : ''}`} style={{ width: `${b.percent ?? 0}%` }} /></span>
              <span className="ka-size-num">{formatBytes(b.used)}{b.max ? ` of ${formatBytes(b.max)} (${b.percent}%)` : ''}</span>
            </div>
          ))}
        </div>
      )}
      {result && tab === 'problems' && (
        <div className="ka-diags">
          {diags.map((d, i) => (
            <button key={i} className={`ka-diag ${d.severity}`} onClick={() => onJump(d)} title={d.external ? d.file : `Go to ${d.file === 'sketch.ino' ? 'the sketch' : d.file}, line ${d.line}`}>
              {d.severity === 'error' ? <CircleX size={13} /> : d.severity === 'warning' ? <AlertTriangle size={13} /> : <Info size={13} />}
              <span className="ka-diag-where">{d.external ? d.file.split('/').pop() : d.file === 'sketch.ino' ? 'sketch' : d.file}:{d.line}</span>
              <span className="ka-diag-msg">{d.message}</span>
            </button>
          ))}
          {!diags.length && <div className="k-muted ka-pad">{result.ok ? 'No problems.' : 'No line-level problems were reported: see Output.'}</div>}
        </div>
      )}
      {result && tab === 'output' && (
        <pre className={`ka-out ${result.ok ? 'ok' : 'bad'}`} aria-label="Compiler output">
          {result.output}
        </pre>
      )}
    </section>
  )
}
