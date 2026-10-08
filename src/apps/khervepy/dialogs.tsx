// KhervePY's own dialogs: GitHub token, Clone, Commit + Push, commit identity,
// and "My repositories". They sit over the window (the OS dialogs are used
// for simple questions).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Check, CloudUpload, Copy, Eye, EyeOff, FolderOpen, GitBranch, KeyRound, LoaderCircle, Lock, Search, UserRound, X,
} from 'lucide-react'
import { os, fs, path, HOME } from '@/os'
import { useAuth } from '@/os/server'
import * as git from '@/os/services/git'

function Modal({ title, icon, onClose, children, wide, busy }: {
  title: string
  icon: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
  busy?: boolean
}) {
  return (
    <div className="kpy-overlay" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className={`kpy-dialog${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="kpy-dialog-head">
          {icon}
          <span>{title}</span>
          <button className="k-icon-btn" title="Close" onClick={onClose} disabled={busy}>
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const errorText = (e: unknown) => git.describeGitError(e)

// ------------------------------------------------------------------ token

export function TokenDialog({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState(git.getGithubToken())
  const [show, setShow] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ login?: string; error?: string } | null>(
    git.getGithubLogin() ? { login: git.getGithubLogin() } : null,
  )
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => field.current?.focus(), [])

  const test = async () => {
    const t = token.trim()
    if (!t) return setResult({ error: 'Enter a token first.' })
    setTesting(true)
    setResult(null)
    try {
      const user = await git.githubUser(t)
      setResult({ login: user.login })
      return user.login
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) })
      return null
    } finally {
      setTesting(false)
    }
  }

  const save = async (anyway = false) => {
    const t = token.trim()
    if (!t || anyway) {
      git.setGithubToken(t || null, null)
      onClose()
      return
    }
    const login = result?.login && t === git.getGithubToken() ? result.login : await test()
    if (login) {
      git.setGithubToken(t, login)
      onClose()
    }
  }

  return (
    <Modal title="GitHub Token" icon={<KeyRound size={16} />} onClose={onClose} busy={testing}>
      <form
        className="kpy-dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <p className="kpy-dialog-text">
          kPY uses a GitHub <b>personal access token</b> to clone private repositories, push, fork and list your
          repositories. It is kept in this browser only — never in a repository — and is only ever sent to github.com.
        </p>
        <button type="button" className="k-link-btn kpy-left" onClick={() => os.openUrl(git.CREATE_TOKEN_URL)}>
          Create a token on GitHub (classic, “repo” scope)…
        </button>
        <label className="kpy-field">
          <span>Personal access token</span>
          <div className="kpy-field-row">
            <input
              ref={field}
              className="k-input"
              type={show ? 'text' : 'password'}
              value={token}
              placeholder="ghp_… or github_pat_…"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setToken(e.target.value)
                setResult(null)
              }}
            />
            <button type="button" className="k-icon-btn" title={show ? 'Hide' : 'Show'} onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button type="button" className="k-btn small" onClick={() => void test()} disabled={testing}>
              {testing ? <LoaderCircle size={13} className="k-spin" /> : null} Test
            </button>
          </div>
        </label>
        <div className="kpy-dialog-note">
          {result?.login && (
            <span className="kpy-ok">
              <Check size={13} /> Signed in as <b>{result.login}</b>
            </span>
          )}
          {result?.error && <span className="kpy-err">{result.error}</span>}
        </div>
        <div className="k-dialog-buttons">
          {result?.error && token.trim() && (
            <button type="button" className="k-btn" onClick={() => void save(true)} title="Keep it even though GitHub didn't accept it now (e.g. offline)">
              Save Anyway
            </button>
          )}
          {git.getGithubToken() && (
            <button
              type="button"
              className="k-btn kpy-push-left"
              onClick={() => {
                git.setGithubToken(null)
                onClose()
              }}
            >
              Remove Token
            </button>
          )}
          <button type="button" className="k-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="k-btn primary" disabled={testing}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ------------------------------------------------------------------ clone

export function CloneDialog({ initialUrl, onClose, onCloned }: { initialUrl?: string; onClose: () => void; onCloned: (dir: string) => void }) {
  const [url, setUrl] = useState(initialUrl ?? '')
  const [parent, setParent] = useState(`${HOME}/Projects`)
  const [name, setName] = useState(initialUrl ? git.repoNameFromUrl(initialUrl) : '')
  const [nameEdited, setNameEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<git.Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => field.current?.focus(), [])

  const dest = name.trim() ? path.join(parent, name.trim()) : ''
  const taken = !!dest && fs.exists(dest) && !(fs.isDir(dest) && fs.list(dest).length === 0)

  const clone = async () => {
    if (!url.trim() || !dest) return
    setBusy(true)
    setError(null)
    try {
      await fs.mkdir(parent, { recursive: true })
      await git.clone(url, dest, { ...git.githubAuth(), onProgress: setProgress })
      onCloned(dest)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const pct = progress?.total ? Math.round((100 * progress.loaded) / progress.total) : null

  return (
    <Modal title="Clone Repository" icon={<Copy size={16} />} onClose={onClose} busy={busy}>
      <form
        className="kpy-dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          void clone()
        }}
      >
        <label className="kpy-field">
          <span>Repository URL</span>
          <input
            ref={field}
            className="k-input"
            value={url}
            placeholder="https://github.com/owner/repo  or  owner/repo"
            spellCheck={false}
            disabled={busy}
            onChange={(e) => {
              setUrl(e.target.value)
              if (!nameEdited) setName(e.target.value.trim() ? git.repoNameFromUrl(e.target.value) : '')
            }}
          />
        </label>
        <label className="kpy-field">
          <span>Into folder</span>
          <div className="kpy-field-row">
            <input className="k-input" value={path.pretty(parent)} readOnly disabled={busy} />
            <button
              type="button"
              className="k-icon-btn"
              title="Choose a folder"
              disabled={busy}
              onClick={async () => {
                const p = await os.dialog.pickFolder({ title: 'Clone into…', startDir: fs.isDir(parent) ? parent : HOME })
                if (p) setParent(p)
              }}
            >
              <FolderOpen size={15} />
            </button>
          </div>
        </label>
        <label className="kpy-field">
          <span>Name</span>
          <input
            className="k-input"
            value={name}
            spellCheck={false}
            disabled={busy}
            onChange={(e) => {
              setName(e.target.value)
              setNameEdited(true)
            }}
          />
        </label>
        <div className="kpy-dialog-note">
          {busy ? (
            <span className="kpy-progress">
              <LoaderCircle size={13} className="k-spin" />
              {progress ? `${progress.phase}${pct !== null ? ` — ${pct}%` : progress.loaded ? ` — ${progress.loaded}` : ''}` : 'Connecting…'}
            </span>
          ) : error ? (
            <span className="kpy-err">{error}</span>
          ) : taken ? (
            <span className="kpy-err">{path.pretty(dest)} already exists.</span>
          ) : dest ? (
            <span className="kpy-muted">Will clone into {path.pretty(dest)}</span>
          ) : null}
        </div>
        {pct !== null && busy && (
          <div className="kpy-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="k-dialog-buttons">
          <button type="button" className="k-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="k-btn primary" disabled={busy || !url.trim() || !dest || taken}>
            Clone
          </button>
        </div>
      </form>
    </Modal>
  )
}

// --------------------------------------------------------- commit + push

export function CommitPushDialog({
  root, branch, changes, onClose, onDone, onToken,
}: {
  root: string
  branch: string | null
  changes: number
  onClose: () => void
  onDone: (msg: string) => void
  /** Open the GitHub token dialog (the push needed a login). */
  onToken: () => void
}) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsToken, setNeedsToken] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => field.current?.focus(), [])

  const go = async () => {
    if (!message.trim()) return setError('Write a commit message first.')
    setError(null)
    try {
      const author = await git.resolveIdentity(root)
      if (!author) throw new git.GitError('Set your name and email for commits first (Git › Identity…).')
      setBusy('Staging…')
      await git.stageAll(root)
      setBusy('Committing…')
      const oid = await git.commit(root, { message, author })
      setBusy('Pushing…')
      try {
        await git.push(root, git.githubAuth())
      } catch (e) {
        const code = (e as { code?: string } | null)?.code
        setNeedsToken(code === 'AuthRequired' || code === 'AuthFailed' || code === 'Forbidden')
        onDone(`Committed ${oid.slice(0, 7)} — but the push failed: ${errorText(e)}`)
        setError(`Committed ${oid.slice(0, 7)}, but the push failed: ${errorText(e)}`)
        setMessage('')
        return
      }
      onDone(`Committed ${oid.slice(0, 7)} and pushed.`)
      onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal title="Commit + Push" icon={<CloudUpload size={16} />} onClose={onClose} busy={!!busy} wide>
      <form
        className="kpy-dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          void go()
        }}
      >
        <p className="kpy-dialog-text">
          On <b>{branch ?? 'a detached HEAD'}</b> · {changes} change{changes === 1 ? '' : 's'} will be staged, committed and pushed.
        </p>
        <textarea
          ref={field}
          className="k-input kpy-commit-text"
          value={message}
          placeholder={'Summary line\n\nOptional body — as many lines as you like.'}
          spellCheck
          disabled={!!busy}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void go()
            }
          }}
        />
        <div className="kpy-dialog-note">
          {busy ? (
            <span className="kpy-progress">
              <LoaderCircle size={13} className="k-spin" /> {busy}
            </span>
          ) : error ? (
            <span className="kpy-err">{error}</span>
          ) : (
            <span className="kpy-muted">⌘/Ctrl + Enter to commit and push</span>
          )}
        </div>
        <div className="k-dialog-buttons">
          {needsToken && (
            <button type="button" className="k-btn kpy-push-left" onClick={onToken}>
              Set GitHub Token…
            </button>
          )}
          <button type="button" className="k-btn" onClick={onClose} disabled={!!busy}>
            {error?.startsWith('Committed') ? 'Close' : 'Cancel'}
          </button>
          <button type="submit" className="k-btn primary" disabled={!!busy || !message.trim()}>
            Commit &amp; Push
          </button>
        </div>
      </form>
    </Modal>
  )
}

// --------------------------------------------------------------- identity

export function IdentityDialog({ root, onClose, onSaved }: { root: string | null; onClose: () => void; onSaved?: () => void }) {
  const kherveUser = useAuth((s) => s.user)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [global, setGlobal] = useState(true)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    void (async () => {
      const repoIdentity = root ? await git.service.configIdentity(root) : null
      const current = repoIdentity ?? git.getGlobalIdentity()
      if (repoIdentity) setGlobal(false)
      if (current) {
        if (!stale) {
          setName(current.name)
          setEmail(current.email)
        }
        return
      }
      if (kherveUser && !stale) setName(kherveUser.display_name)
      const token = git.getGithubToken()
      if (!token) return
      try {
        const u = await git.githubUser(token)
        if (stale) return
        setName((n) => n || u.name || u.login)
        setEmail(u.email || git.noreplyEmail(u))
        setHint(u.email ? null : 'Your GitHub “noreply” address keeps your email private.')
      } catch {
        /* fill it in by hand */
      }
    })()
    return () => {
      stale = true
    }
  }, [root, kherveUser])

  const valid = name.trim() && /^[^\s@]+@[^\s@]+$/.test(email.trim())

  const save = async () => {
    if (!valid) return
    const id = { name: name.trim(), email: email.trim() }
    if (global || !root) git.setGlobalIdentity(id)
    else {
      await git.setConfig(root, 'user.name', id.name)
      await git.setConfig(root, 'user.email', id.email)
    }
    onSaved?.()
    onClose()
  }

  return (
    <Modal title="Commit Identity" icon={<UserRound size={16} />} onClose={onClose}>
      <form
        className="kpy-dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <p className="kpy-dialog-text">Your name and email are written into every commit you make.</p>
        <label className="kpy-field">
          <span>Name</span>
          <input className="k-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="kpy-field">
          <span>Email</span>
          <input className="k-input" value={email} onChange={(e) => setEmail(e.target.value)} spellCheck={false} />
        </label>
        {hint && <div className="kpy-dialog-note kpy-muted">{hint}</div>}
        {root && (
          <label className="kpy-check">
            <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} />
            Use for all my repositories (otherwise only for {path.basename(root)})
          </label>
        )}
        <div className="k-dialog-buttons">
          <button type="button" className="k-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="k-btn primary" disabled={!valid}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ------------------------------------------------------- my repositories

export function ReposDialog({ onClose, onClone }: { onClose: () => void; onClone: (url: string) => void }) {
  const [repos, setRepos] = useState<git.GithubRepo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<git.GithubRepo | null>(null)

  useEffect(() => {
    const token = git.getGithubToken()
    if (!token) {
      setError('Set a GitHub token first (Git › GitHub Token…).')
      return
    }
    git.githubRepos(token).then(setRepos, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (repos ?? []).filter((r) => !q || r.full_name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q))
  }, [repos, filter])

  return (
    <Modal title="My Repositories" icon={<GitBranch size={16} />} onClose={onClose} wide>
      <div className="kpy-dialog-body">
        <div className="kpy-field-row">
          <Search size={14} className="kpy-muted-icon" />
          <input className="k-input" value={filter} placeholder="Filter…" onChange={(e) => setFilter(e.target.value)} autoFocus />
        </div>
        <div className="kpy-repos">
          {error && <div className="kpy-err">{error}</div>}
          {!repos && !error && (
            <div className="kpy-placeholder">
              <LoaderCircle size={14} className="k-spin" /> Asking GitHub…
            </div>
          )}
          {repos && shown.length === 0 && <div className="kpy-placeholder">No repositories.</div>}
          {shown.map((r) => (
            <div
              key={r.id}
              className={`kpy-repo${picked?.id === r.id ? ' selected' : ''}`}
              onClick={() => setPicked(r)}
              onDoubleClick={() => onClone(r.clone_url)}
            >
              <div className="kpy-repo-name">
                {r.private && <Lock size={12} />} {r.full_name}
                {r.fork && <span className="kpy-badge">fork</span>}
              </div>
              {r.description && <div className="kpy-repo-desc">{r.description}</div>}
            </div>
          ))}
        </div>
        <div className="k-dialog-buttons">
          <button className="k-btn" onClick={onClose}>
            Close
          </button>
          <button className="k-btn primary" disabled={!picked} onClick={() => picked && onClone(picked.clone_url)}>
            Clone…
          </button>
        </div>
      </div>
    </Modal>
  )
}
