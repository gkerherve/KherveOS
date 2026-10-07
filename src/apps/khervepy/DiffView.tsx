// A unified diff, coloured: additions, deletions, hunk headers (the desktop app's Diff dock).

import { memo } from 'react'

export interface DiffContent {
  title: string
  patch: string
}

const MAX_LINES = 6000

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'hunk'
  if (/^(diff |index |--- |\+\+\+ |new file|deleted file|Binary files|\\ No newline)/.test(line)) return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return ''
}

export const DiffView = memo(function DiffView({ diff, onOpen }: { diff: DiffContent | null; onOpen?: () => void }) {
  if (!diff) return <div className="kpy-placeholder">Click a changed file in the Git or Log panel to see its diff.</div>
  const lines = diff.patch ? diff.patch.replace(/\n$/, '').split('\n') : []
  const shown = lines.slice(0, MAX_LINES)
  return (
    <div className="kpy-diff">
      <div className="kpy-diff-title">
        <span title={diff.title}>{diff.title}</span>
        {onOpen && (
          <button className="k-link-btn" onClick={onOpen}>
            Open file
          </button>
        )}
      </div>
      {lines.length ? (
        <pre className="kpy-diff-body">
          {shown.map((l, i) => (
            <div key={i} className={`kpy-dl ${lineClass(l)}`}>
              {l || ' '}
            </div>
          ))}
          {lines.length > MAX_LINES && <div className="kpy-dl meta">… {lines.length - MAX_LINES} more lines</div>}
        </pre>
      ) : (
        <div className="kpy-placeholder">No changes.</div>
      )}
    </div>
  )
})
