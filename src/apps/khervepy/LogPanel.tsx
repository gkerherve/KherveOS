// The Log dock: the commit graph (lanes like VS Code's Git Graph), and for the
// selected commit its full message and the files it changed (the desktop
// app's commit_log.py).

import { memo, useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, LoaderCircle, RefreshCw } from 'lucide-react'
import { path } from '@/os'
import * as git from '@/os/services/git'
import { LANE_COLORS, buildLanes, laneCount, type GraphRow } from './graph'

const ROW_H = 22
const LANE_W = 14
const DEPTH = 300

const STATUS_CLASS: Record<git.ChangeKind, string> = { A: 'added', M: 'modified', D: 'deleted' }

/** "Today 16:26", "Yesterday 09:02", "Mon 14:07", else the date (the desktop app's format). */
export function friendlyDate(ms: number): string {
  const d = new Date(ms)
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const day = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000)
  const delta = day(new Date()) - day(d)
  if (delta === 0) return `Today ${hm}`
  if (delta === 1) return `Yesterday ${hm}`
  if (delta > 1 && delta < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${hm}`
  return d.toISOString().slice(0, 10)
}

/** "Gwilherm Kerherve" → "G Kerherve". */
function shortAuthor(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2 ? `${parts[0][0]} ${parts[parts.length - 1]}` : name
}

/** Ref badges with the noise trimmed: "origin/<current branch>" becomes "origin". */
function badges(refs: git.RefLabel[]): git.RefLabel[] {
  const head = refs.find((r) => r.kind === 'head')?.name
  return refs.map((r) => (r.kind === 'remote' && head && r.name.endsWith(`/${head}`) ? { ...r, name: r.name.slice(0, -head.length - 1) } : r))
}

function Graph({ row, lanes }: { row: GraphRow; lanes: number }) {
  const px = (x: number) => (x + 0.5) * LANE_W
  const py = (y: number) => y * ROW_H
  return (
    <svg className="kpy-graph" width={lanes * LANE_W} height={ROW_H} aria-hidden>
      {row.segments.map((s, i) => {
        const color = LANE_COLORS[s.color % LANE_COLORS.length]
        const [x0, y0, x1, y1] = [px(s.x0), py(s.y0), px(s.x1), py(s.y1)]
        if (s.x0 === s.x1) return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={color} strokeWidth={2} />
        const ym = (y0 + y1) / 2
        return <path key={i} d={`M${x0} ${y0} C${x0} ${ym} ${x1} ${ym} ${x1} ${y1}`} stroke={color} strokeWidth={2} fill="none" />
      })}
      <circle cx={px(row.col)} cy={ROW_H / 2} r={4} fill={LANE_COLORS[row.col % LANE_COLORS.length]} stroke="var(--k-bg)" strokeWidth={1.5} />
    </svg>
  )
}

/** Operations that move refs (the graph only needs reloading after these). */
const REF_OPS = new Set(['init', 'clone', 'commit', 'checkout', 'branch', 'fetch', 'pull', 'push'])

export const LogPanel = memo(function LogPanel({
  root, busy, allBranches, setAllBranches, onPull, showDiff,
}: {
  root: string | null
  busy: string | null
  allBranches: boolean
  setAllBranches: (v: boolean) => void
  onPull: () => void
  showDiff: (title: string, patch: string, file?: string) => void
}) {
  const [commits, setCommits] = useState<git.CommitInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [files, setFiles] = useState<git.ChangedFile[] | null>(null)
  const [reload, setReload] = useState(0)

  // Reload after commits, checkouts, pulls… made by any window.
  useEffect(
    () =>
      git.onChange((ev) => {
        if (root && REF_OPS.has(ev.op) && (ev.dir === root || path.isInside(ev.dir, root))) setReload((n) => n + 1)
      }),
    [root],
  )

  useEffect(() => {
    if (!root) {
      setCommits(null)
      return
    }
    let stale = false
    git.log(root, { all: allBranches, depth: DEPTH }).then(
      (list) => {
        if (stale) return
        setCommits(list)
        setError(null)
        setSelected((cur) => (cur && list.some((c) => c.oid === cur) ? cur : (list[0]?.oid ?? null)))
      },
      (e: unknown) => !stale && setError(git.describeGitError(e)),
    )
    return () => {
      stale = true
    }
  }, [root, allBranches, reload])

  useEffect(() => {
    setFiles(null)
    if (!root || !selected) return
    let stale = false
    git.commitChanges(root, selected).then(
      (f) => !stale && setFiles(f),
      () => !stale && setFiles([]),
    )
    return () => {
      stale = true
    }
  }, [root, selected])

  const rows = useMemo(() => buildLanes(commits ?? []), [commits])
  const lanes = useMemo(() => laneCount(rows), [rows])
  const current = commits?.find((c) => c.oid === selected) ?? null

  if (!root) return <div className="kpy-placeholder">No repository — the log shows a repository’s commits.</div>

  const showCommit = async (c: git.CommitInfo) => {
    const changed = await git.commitChanges(root, c.oid)
    const patches = await Promise.all(changed.map((f) => git.diffCommitFile(root, c.oid, f.path)))
    const head = [`commit ${c.oid}`, `Author: ${c.author.name} <${c.author.email}>`, `Date:   ${new Date(c.author.time).toString()}`, '', ...c.message.split('\n').map((l) => `    ${l}`), '']
    showDiff(`commit ${c.short} — ${c.subject}`, head.join('\n') + '\n' + patches.map((p) => p.patch).join(''))
  }

  const showFile = async (f: git.ChangedFile) => {
    if (!current) return
    const d = await git.diffCommitFile(root, current.oid, f.path)
    showDiff(`${f.path} · commit ${current.short}`, d.patch, f.status === 'D' ? undefined : `${root}/${f.path}`)
  }

  return (
    <div className="kpy-log">
      <div className="kpy-log-head">
        <span className="kpy-log-summary">{commits ? `${commits.length}${commits.length >= DEPTH ? '+' : ''} commits` : error ?? 'Loading…'}</span>
        <label className="kpy-check small" title="Show every branch, remote branch and tag">
          <input type="checkbox" checked={allBranches} onChange={(e) => setAllBranches(e.target.checked)} /> All branches
        </label>
        <button className="k-icon-btn kpy-mini" title="Pull" disabled={!!busy} onClick={onPull}>
          {busy === 'Pulling…' ? <LoaderCircle size={14} className="k-spin" /> : <ArrowDownToLine size={14} />}
        </button>
        <button className="k-icon-btn kpy-mini" title="Refresh" onClick={() => setReload((n) => n + 1)}>
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="kpy-log-list">
        {commits?.length === 0 && <div className="kpy-placeholder">No commits yet.</div>}
        {rows.map((row) => {
          const c = row.commit as git.CommitInfo
          const refs = badges(c.refs)
          return (
            <div
              key={c.oid}
              className={`kpy-commit${selected === c.oid ? ' selected' : ''}`}
              style={{ height: ROW_H }}
              title={`${c.short} — ${c.subject}${refs.length ? `\n${refs.map((r) => r.name).join(', ')}` : ''}`}
              onClick={() => setSelected(c.oid)}
              onDoubleClick={() => void showCommit(c)}
            >
              <Graph row={row} lanes={lanes} />
              <span className="kpy-commit-subject">
                {refs.slice(0, 3).map((r) => (
                  <span key={`${r.kind}:${r.name}`} className={`kpy-ref ${r.kind}`}>
                    {r.name}
                  </span>
                ))}
                {refs.length > 3 && <span className="kpy-ref more">+{refs.length - 3}</span>}
                {c.subject}
              </span>
              <span className="kpy-commit-date">{friendlyDate(c.author.time)}</span>
              <span className="kpy-commit-author">{shortAuthor(c.author.name)}</span>
            </div>
          )
        })}
      </div>
      {current && (
        <div className="kpy-log-details">
          <div className="kpy-log-meta">
            <b>{current.short}</b> · {current.author.name} · {new Date(current.author.time).toLocaleString()}
            {current.refs.length > 0 && <div className="kpy-muted">{current.refs.map((r) => r.name).join(', ')}</div>}
          </div>
          <pre className="kpy-log-message">{current.message}</pre>
          <div className="kpy-section">
            <span>Files changed</span>
            <span className="kpy-count">{files?.length ?? '…'}</span>
          </div>
          <div className="kpy-log-files">
            {files?.map((f) => (
              <div key={f.path} className="kpy-change" onClick={() => void showFile(f)} title={`${f.status}  ${f.path}`}>
                <span className={`kpy-letter st-${STATUS_CLASS[f.status]}`}>{f.status}</span>
                <span className={`kpy-change-name st-${STATUS_CLASS[f.status]}`}>{path.basename(f.path)}</span>
                {path.dirname(f.path) !== '.' && path.dirname(f.path) !== '/' && <span className="kpy-change-dir">{path.dirname(f.path)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})
