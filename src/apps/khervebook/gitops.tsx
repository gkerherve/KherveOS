// The Git menu (desktop mainwindow._git_after_save, _commit_and_maybe_push,
// _pull_from_remote, _configure_remotes, _show_history, _show_branches,
// git_backend.py, remote_dialog.py, history_dialog.py) on KherveOS's Git
// service: the notebook's folder is its own repository (fresh ones start on
// "dev"; a notebook inside an existing repository commits there), every save
// is a snapshot of that notebook's files, and a connected cloud gets them.

import { useEffect, useState } from 'react'
import { os, HOME } from '@/os'
import { basename, dirname, extname, pretty } from '@/os/path'
import * as git from '@/os/services/git'
import { Mdi } from './mdi'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function stemOf(path: string): string {
  const n = basename(path)
  const e = extname(n)
  return e ? n.slice(0, -e.length) : n
}

/** The repository a notebook belongs to: an enclosing one, else its own folder. */
function repoFor(path: string): string {
  return git.findRoot(dirname(path)) ?? dirname(path)
}

/** desktop git_backend._signature: the user's identity, else "KherveBook". */
async function author(dir: string): Promise<git.Identity> {
  return (await git.resolveIdentity(dir)) ?? { name: 'kBook', email: 'khervebook@local' }
}

/** Paths (relative to the repository) of a notebook's files: the .kbook and its "<stem>_files" folder (desktop commit_all with file_stem). */
function notebookFiles(repo: string, path: string): string[] {
  const folder = dirname(path)
  const stem = stemOf(path)
  const rel = (p: string) => p.slice(repo.length + 1)
  const out: string[] = []
  for (const s of os.fs.list(folder)) {
    if (!s.name.startsWith(stem)) continue
    if (s.type === 'file') out.push(rel(s.path))
    else if (s.type === 'dir') for (const f of os.fs.walk(s.path)) if (f.type === 'file') out.push(rel(f.path))
  }
  return out
}

/** Stage the notebook's files and commit; null when nothing changed (desktop commit_all). */
async function commitNotebook(path: string, message: string): Promise<string | null> {
  const folder = dirname(path)
  // The web edition never creates a repository by itself: snapshots only happen
  // for a notebook that already sits in one (made in KhervePY, or cloned).
  const repo = git.findRoot(folder)
  if (!repo) return null
  const files = notebookFiles(repo, path)
  if (files.length) await git.add(repo, files)
  try {
    return await git.commit(repo, { message, author: await author(repo) })
  } catch (e) {
    if (e instanceof git.GitError && e.code === 'NothingToCommit') return null
    throw e
  }
}

const stamp = () => new Date().toISOString().slice(0, 19)

/** After every save (desktop _git_after_save): a snapshot, uploaded when the repository has a remote. Returns the status message. */
export async function gitAfterSave(path: string, message?: string): Promise<string> {
  let oid: string | null
  try {
    oid = await commitNotebook(path, message || `Save ${basename(path)} at ${stamp()}`)
  } catch (e) {
    return `Snapshot failed: ${errText(e)}`
  }
  if (!oid) return git.findRoot(dirname(path)) ? 'Saved (nothing new to snapshot)' : ''
  const repo = repoFor(path)
  if (!(await git.getRemoteUrl(repo))) return 'Saved and snapshot created (use Git → Connect to GitHub to enable cloud backup)'
  try {
    await git.push(repo, git.githubAuth())
    return 'Saved, snapshot created, and uploaded to cloud'
  } catch (e) {
    void showPushFailure(errText(e))
    return 'Saved and snapshot created (upload failed — see dialog)'
  }
}

/** desktop _show_push_failure_dialog */
function showPushFailure(msg: string) {
  const low = msg.toLowerCase()
  const hints: string[] = []
  if (low.includes('auth') || low.includes('401') || low.includes('403')) {
    hints.push('GitHub needs a Personal Access Token: create one (classic, with the "repo" scope) and add it in KherveOS Settings › Git, or in kPY.')
  } else if (low.includes('not found') || low.includes('404')) {
    hints.push('GitHub says the repository does not exist. Check that the URL in Git → Connect to GitHub matches the one on the repo’s GitHub page (Code → HTTPS).')
  } else if (low.includes('pull first') || low.includes('rejected') || low.includes('fast')) {
    hints.push('Someone else pushed to this branch since you last pulled. Use Git → Download Latest from Cloud first, then save again.')
  }
  return os.dialog.alert(
    <div className="nb-git-msg">
      <p>
        <b>Could not upload to cloud.</b>
      </p>
      <p>
        <code>{msg}</code>
      </p>
      {hints.map((h) => (
        <p key={h}>{h}</p>
      ))}
    </div>,
    { title: 'Upload failed' },
  )
}

// ------------------------------------------------------------- the menu

/** Git → Save Snapshot & Upload: a commit message, then save (desktop _commit_and_maybe_push). */
export async function snapshotAndUpload(path: string | null, save: (message: string) => Promise<boolean>, saveAs: () => Promise<boolean>) {
  if (!path) {
    await saveAs() // no file yet: saving creates the first snapshot
    return
  }
  if (!git.findRoot(dirname(path))) {
    await os.dialog.alert('This notebook is not in a Git repository, so there is no snapshot to make: Save (Ctrl+S) keeps it. (Repositories are made in kPY.)', {
      title: 'Save Snapshot & Upload',
    })
    return
  }
  const def = `Save ${basename(path)} at ${stamp()}`
  const msg = await os.dialog.prompt('Describe what you changed:', { title: 'Commit message', defaultValue: def })
  if (msg === null) return
  await save(msg.trim() || def)
}

/** Git → Download Latest from Cloud (desktop _pull_from_remote). */
export async function downloadLatest(path: string | null, reload: () => Promise<void>, flash: (t: string) => void) {
  if (!path) {
    await os.dialog.alert('You need to save your notebook first.\n\nUse File → Save (Ctrl+S), then try again.', { title: 'Download latest' })
    return
  }
  const repo = repoFor(path)
  if (!git.findRoot(dirname(path)) || !(await git.getRemoteUrl(repo))) {
    await os.dialog.alert('This notebook is not in a Git repository connected to a cloud service. (Repositories are made and connected in kPY.)', {
      title: 'Download latest',
    })
    return
  }
  flash('Downloading latest from origin…')
  try {
    const r = await git.pull(repo, { ...git.githubAuth(), author: await git.resolveIdentity(repo) })
    if (r.upToDate) flash('Already up to date — you have the latest version')
    else {
      flash(r.fastForward ? 'Downloaded the latest version' : 'Downloaded and merged the latest version')
      await reload()
    }
  } catch (e) {
    await os.dialog.alert(
      `${errText(e)}\n\nWhat you can try:\n  • Check your internet connection\n  • Make sure the cloud URL is correct (Git → Connect to GitHub)\n  • If the problem says "diverged", resolve the merge in kPY's Git panel`,
      { title: 'Download failed' },
    )
  }
}

function RemoteEditor({ repo }: { repo: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    void git.getRemoteUrl(repo).then((u) => setUrl(u ?? ''))
  }, [repo])
  const save = async (u: string | null) => {
    try {
      if (u) await git.setRemoteUrl(repo, git.normalizeRepoUrl(u))
      else await git.setConfig(repo, 'remote.origin.url', null)
      setUrl(u ? git.normalizeRepoUrl(u) : '')
      setMsg(u ? 'Connected. The next save uploads the notebook.' : 'Connection removed.')
    } catch (e) {
      setMsg(errText(e))
    }
  }
  return (
    <div className="nb-git-remote">
      <p>
        Link this notebook’s folder (<code>{pretty(repo)}</code>) to a cloud repository on GitHub, GitLab or any Git server. Each save is then uploaded
        there, and <b>Download Latest from Cloud</b> fetches what collaborators pushed.
      </p>
      <table className="nb-git-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody>
          {url ? (
            <tr>
              <td>origin</td>
              <td>{url}</td>
            </tr>
          ) : (
            <tr>
              <td colSpan={2} className="k-muted">
                No connection yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="nb-git-buttons">
        <button
          className="k-btn"
          onClick={async () => {
            const u = await os.dialog.prompt('Repository URL (Code → HTTPS on its GitHub page):', { title: 'Add connection', defaultValue: url ?? '' })
            if (u?.trim()) await save(u.trim())
          }}
        >
          ➕ Add connection
        </button>
        <button
          className="k-btn"
          disabled={!url}
          onClick={async () => {
            const u = await os.dialog.prompt('Repository URL:', { title: 'Edit URL', defaultValue: url ?? '' })
            if (u?.trim()) await save(u.trim())
          }}
        >
          ✏ Edit URL
        </button>
        <button className="k-btn" disabled={!url} onClick={() => void save(null)}>
          ✖ Remove
        </button>
      </div>
      {msg && <p className="nb-git-note">{msg}</p>}
      <p className="k-muted">
        For a private repository or to upload, KherveOS needs a GitHub token (Settings › Git, or kPY’s Git panel). Tokens only go to github.com.
      </p>
    </div>
  )
}

/** Git → Connect to GitHub / GitLab… (desktop RemoteDialog). */
export async function connectToCloud(path: string | null) {
  if (!path) {
    await os.dialog.alert('You need to save your notebook first so kBook knows where to create the connection.\n\nUse File → Save (Ctrl+S), then try again.', {
      title: 'Connect to cloud',
    })
    return
  }
  let repo = git.findRoot(dirname(path))
  if (!repo && dirname(path) === HOME) {
    await os.dialog.alert('Save the notebook in a folder (for example ~/Notebooks) first: the home folder itself does not become a repository.', { title: 'Connect to cloud' })
    return
  }
  if (!repo) {
    await git.init(dirname(path), { defaultBranch: 'dev' })
    repo = dirname(path)
  }
  await os.dialog.alert(<RemoteEditor repo={repo} />, { title: 'Connect to cloud' })
}

interface HistRow {
  info: git.CommitInfo
  files: string[]
}

function History({ repo, path, reload, branchesOnly }: { repo: string; path: string; reload: () => Promise<void>; branchesOnly: boolean }) {
  const [rows, setRows] = useState<HistRow[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [br, setBr] = useState<git.Branches | null>(null)
  const [pick, setPick] = useState('')
  const [msg, setMsg] = useState('')
  const [tick, setTick] = useState(0)
  const stem = stemOf(path)
  const relNb = path.slice(repo.length + 1)
  useEffect(() => {
    let alive = true
    void (async () => {
      const b = await git.branches(repo)
      if (!alive) return
      setBr(b)
      setPick(b.current ?? '')
      const log = await git.log(repo, { depth: 200 })
      const out: HistRow[] = []
      for (const info of log) {
        const files = (await git.commitChanges(repo, info.oid)).map((c) => c.path)
        // desktop history_detailed(file_stem): only commits that touch this notebook's files
        if (branchesOnly || files.some((f) => basename(f).startsWith(stem))) out.push({ info, files })
      }
      if (alive) setRows(out)
    })().catch((e) => alive && setMsg(errText(e)))
    return () => {
      alive = false
    }
  }, [repo, stem, branchesOnly, tick])
  useEffect(() => {
    if (!sel) return setDiff('')
    let alive = true
    void git
      .diffCommitFile(repo, sel, relNb)
      .then((d) => alive && setDiff(d.binary ? '(binary)' : d.patch || '(this version did not change the notebook itself)'))
      .catch((e) => alive && setDiff(errText(e)))
    return () => {
      alive = false
    }
  }, [repo, sel, relNb])
  const act = (fn: () => Promise<unknown>, done: string) => async () => {
    try {
      await fn()
      setMsg(done)
      setTick((t) => t + 1)
    } catch (e) {
      setMsg(errText(e))
    }
  }
  const restore = async () => {
    if (!sel) return
    const ok = await os.dialog.confirm('Bring the notebook back to this version? Its current content is replaced (the change is a new snapshot you can undo the same way).', {
      title: 'Restore this version',
      okLabel: 'Restore',
    })
    if (!ok) return
    const text = await git.readTextAtCommit(repo, sel, relNb)
    if (text === null) return setMsg('That version has no copy of this notebook.')
    await os.fs.writeText(path, text)
    await reload()
    setMsg('Restored. Save to keep it as a new snapshot.')
  }
  return (
    <div className="nb-git-history">
      <div className="nb-git-branchrow">
        <Mdi name="mdi.source-branch" size={18} />
        <span>
          Branch: <b>{br?.current ?? '(detached)'}</b>
        </span>
        <select className="k-input" title="Switch to another branch" value={pick} onChange={(e) => setPick(e.target.value)}>
          {(br?.local ?? []).map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <button
          className="k-btn"
          title="Switch working tree to the selected branch"
          disabled={!pick || pick === br?.current}
          onClick={act(async () => {
            await git.checkout(repo, pick)
            await reload()
          }, `Switched to ${pick}`)}
        >
          Switch
        </button>
        <button
          className="k-btn"
          title="Create a new branch from HEAD"
          onClick={async () => {
            const name = await os.dialog.prompt('New branch name:', { title: 'New branch' })
            if (name?.trim()) await act(() => git.createBranch(repo, name.trim(), { checkout: true }), `Created and switched to ${name.trim()}`)()
          }}
        >
          + New branch
        </button>
        <button
          className="k-btn"
          title="Delete the selected branch"
          disabled={!pick || pick === br?.current}
          onClick={async () => {
            if (await os.dialog.confirm(`Delete the branch “${pick}”?`, { title: 'Delete branch', danger: true, okLabel: 'Delete' })) {
              await act(() => git.deleteBranch(repo, pick), `Deleted ${pick}`)()
            }
          }}
        >
          Delete
        </button>
      </div>
      <div className="nb-git-split">
        <div className="nb-git-list" role="listbox">
          {rows === null ? (
            <div className="k-muted">Reading the history…</div>
          ) : !rows.length ? (
            <div className="k-muted">No snapshots yet.</div>
          ) : (
            rows.map(({ info }) => (
              <div
                key={info.oid}
                role="option"
                aria-selected={sel === info.oid}
                className={`nb-git-commit${sel === info.oid ? ' sel' : ''}`}
                onClick={() => setSel(info.oid)}
              >
                <span className="nb-git-dot" />
                <span className="nb-git-subject">{info.subject}</span>
                {info.refs.map((r) => (
                  <span key={r.name} className={`nb-git-ref ${r.kind}`}>
                    {r.name}
                  </span>
                ))}
                <span className="nb-git-meta">
                  {new Date(info.author.time).toLocaleString()} · {info.author.name} · {info.short}
                </span>
              </div>
            ))
          )}
        </div>
        <pre className="nb-git-diff">{sel ? diff : 'Select a snapshot to see what changed.'}</pre>
      </div>
      <div className="nb-git-buttons">
        <button className="k-btn" disabled={!sel} onClick={() => void restore()}>
          Restore this version
        </button>
        {msg && <span className="nb-git-note">{msg}</span>}
      </div>
    </div>
  )
}

/** Git → View Version History… / Branches… (desktop HistoryDialog). */
export async function showHistory(path: string | null, reload: () => Promise<void>, branches = false) {
  const title = branches ? 'Branches' : 'Version history'
  if (!path) {
    await os.dialog.alert(
      branches
        ? 'Save your notebook first so the repository exists.'
        : 'You need to save your notebook at least once before there is any history to show.\n\nUse File → Save (Ctrl+S), then try again.',
      { title },
    )
    return
  }
  const repo = git.findRoot(dirname(path))
  if (!repo || !(await git.log(repo, { depth: 1 })).length) {
    await os.dialog.alert('No snapshots yet. Every time you save, kBook automatically creates a snapshot.\n\nSave your notebook and come back to see its history.', {
      title,
    })
    return
  }
  await os.dialog.alert(<History repo={repo} path={path} reload={reload} branchesOnly={branches} />, { title: `${title} — ${basename(path)}` })
}

