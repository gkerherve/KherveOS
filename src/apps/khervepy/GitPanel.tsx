// The Git dock: branch, staged and unstaged changes, commit, pull / push,
// clone and fork (the desktop app's git_panel.py, VS Code-style lists).

import { useState, type MouseEvent } from 'react'
import {
  ArrowDownToLine, ArrowUpFromLine, Check, Copy, FileCode2, FolderGit2, GitBranch, GitFork, LoaderCircle, Minus, Plus,
  RefreshCw, Undo2,
} from 'lucide-react'
import { os, path, type MenuItem } from '@/os'
import * as git from '@/os/services/git'
import type { Repo } from './repo'

export interface GitActions {
  openFile(p: string): void
  showDiff(title: string, patch: string, file?: string): void
  status(msg: string): void
  commit(message: string, then?: 'push'): Promise<boolean>
  pull(): void
  push(): void
  fetch(): void
  checkout(ref: string): void
  newBranch(): void
  initRepo(): void
  clone(): void
  fork(): void
}

const LETTER_CLASS: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', '?': 'untracked' }

export function GitPanel({ repo, actions }: { repo: Repo; actions: GitActions }) {
  const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const root = repo.root

  if (!root) {
    return (
      <div className="kpy-git-empty">
        <FolderGit2 size={28} className="kpy-muted-icon" />
        <p>This folder isn’t a Git repository.</p>
        <button className="k-btn primary" onClick={actions.initRepo}>
          Initialize Repository
        </button>
        <button className="k-btn" onClick={actions.clone}>
          <Copy size={14} /> Clone…
        </button>
        <button className="k-btn" onClick={actions.fork}>
          <GitFork size={14} /> Fork…
        </button>
      </div>
    )
  }

  const staged = repo.files.filter((f) => f.staged !== ' ')
  const unstaged = repo.files.filter((f) => f.unstaged !== ' ')
  const busy = !!repo.busy
  const current = repo.branches?.current ?? null
  const ab = repo.ab

  const showDiff = async (f: git.FileStatus, inIndex: boolean) => {
    setSelected(`${inIndex ? 'S' : 'U'}:${f.path}`)
    try {
      const d = inIndex
        ? await git.diffFile(root, f.path, { from: 'HEAD', to: 'INDEX' })
        : await git.diffFile(root, f.path, { from: 'INDEX', to: 'WORKDIR' })
      actions.showDiff(`${f.path} · ${inIndex ? 'staged' : f.unstaged === '?' ? 'new file' : 'working tree'}`, d.patch, `${root}/${f.path}`)
    } catch (e) {
      actions.status(git.describeGitError(e))
    }
  }

  const stage = (paths: string[]) => void repo.run('Staging…', () => git.add(root, paths), { quiet: false })
  const unstage = (paths: string[]) => void repo.run('Unstaging…', () => git.unstage(root, paths))

  const fileMenu = (e: MouseEvent, f: git.FileStatus, inIndex: boolean) => {
    e.preventDefault()
    const items: MenuItem[] = [
      { label: 'Show Diff', onClick: () => void showDiff(f, inIndex) },
      { label: 'Open File', icon: FileCode2, disabled: f.unstaged === 'D', onClick: () => actions.openFile(`${root}/${f.path}`) },
      '-',
      inIndex
        ? { label: 'Unstage', icon: Minus, onClick: () => unstage([f.path]) }
        : { label: 'Stage', icon: Plus, onClick: () => stage([f.path]) },
      '-',
      { label: 'Reveal in Files', onClick: () => os.open('files', { path: path.dirname(`${root}/${f.path}`) }) },
    ]
    os.contextMenu(e, items)
  }

  const row = (f: git.FileStatus, inIndex: boolean) => {
    const letter = inIndex ? f.staged : f.unstaged
    const key = `${inIndex ? 'S' : 'U'}:${f.path}`
    const dir = path.dirname(f.path)
    return (
      <div
        key={key}
        className={`kpy-change${selected === key ? ' selected' : ''}`}
        title={`${f.path} — ${f.label}`}
        onClick={() => void showDiff(f, inIndex)}
        onDoubleClick={() => f.unstaged !== 'D' && actions.openFile(`${root}/${f.path}`)}
        onContextMenu={(e) => fileMenu(e, f, inIndex)}
      >
        <span className={`kpy-letter st-${LETTER_CLASS[letter]}`}>{letter === '?' ? 'U' : letter}</span>
        <span className={`kpy-change-name st-${LETTER_CLASS[letter]}`}>{path.basename(f.path)}</span>
        {dir !== '.' && dir !== '/' && <span className="kpy-change-dir">{dir}</span>}
        <button
          className="k-icon-btn kpy-mini kpy-hover"
          title={inIndex ? 'Unstage' : 'Stage'}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            if (inIndex) unstage([f.path])
            else stage([f.path])
          }}
        >
          {inIndex ? <Minus size={13} /> : <Plus size={13} />}
        </button>
      </div>
    )
  }

  const commit = async (then?: 'push') => {
    if (await actions.commit(message, then)) setMessage('')
  }

  return (
    <div className="kpy-git">
      <div className="kpy-git-branch">
        <GitBranch size={14} className="kpy-muted-icon" />
        <select
          className="k-input kpy-select"
          value={current ?? ''}
          disabled={busy}
          onChange={(e) => e.target.value && actions.checkout(e.target.value)}
        >
          {!current && <option value="">(detached HEAD)</option>}
          {repo.branches?.local.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
          {!!repo.branches?.remote.length && (
            <optgroup label="Remote">
              {repo.branches.remote.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button className="k-btn small" onClick={actions.newBranch} disabled={busy} title="Create a branch here">
          New…
        </button>
      </div>

      <div className="kpy-git-lists">
        <div className="kpy-section">
          <span>Staged Changes</span>
          <span className="kpy-count">{staged.length}</span>
          <button className="k-icon-btn kpy-mini" title="Unstage all" disabled={!staged.length || busy} onClick={() => void repo.run('Unstaging…', () => git.unstageAll(root))}>
            <Undo2 size={13} />
          </button>
        </div>
        {staged.map((f) => row(f, true))}
        <div className="kpy-section">
          <span>Changes</span>
          <span className="kpy-count">{unstaged.length}</span>
          <button className="k-icon-btn kpy-mini" title="Stage all" disabled={!unstaged.length || busy} onClick={() => void repo.run('Staging…', () => git.stageAll(root))}>
            <Plus size={13} />
          </button>
        </div>
        {unstaged.map((f) => row(f, false))}
        {repo.loaded && !repo.files.length && (
          <div className="kpy-placeholder small">
            <Check size={13} /> Nothing to commit — the working tree is clean.
          </div>
        )}
      </div>

      <textarea
        className="k-input kpy-commit-text"
        placeholder={`Commit message…  (summary, blank line, details)\n${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter commits, +Shift also pushes`}
        value={message}
        disabled={busy}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void commit(e.shiftKey ? 'push' : undefined)
          }
        }}
      />
      <div className="kpy-git-buttons">
        <button className="k-btn primary" disabled={busy || !message.trim()} onClick={() => void commit()}>
          <Check size={14} /> Commit
        </button>
        <button className="k-btn" disabled={busy || !message.trim()} onClick={() => void commit('push')} title="Commit, then push to the remote">
          Commit &amp; Push
        </button>
      </div>
      <div className="kpy-git-buttons">
        <button className="k-btn" disabled={busy} onClick={actions.pull} title="Fetch and merge the remote branch">
          <ArrowDownToLine size={14} /> Pull{ab?.behind ? ` ↓${ab.behind}` : ''}
        </button>
        <button className="k-btn" disabled={busy} onClick={actions.push} title="Send your commits to the remote">
          <ArrowUpFromLine size={14} /> Push{ab?.ahead ? ` ↑${ab.ahead}` : ''}
        </button>
        <button className="k-icon-btn" disabled={busy} onClick={actions.fetch} title="Fetch (see what's new without merging)">
          <RefreshCw size={14} />
        </button>
      </div>
      <div className="kpy-git-buttons">
        <button className="k-btn small" onClick={actions.clone} disabled={busy}>
          <Copy size={13} /> Clone…
        </button>
        <button className="k-btn small" onClick={actions.fork} disabled={busy}>
          <GitFork size={13} /> Fork…
        </button>
      </div>
      <div className="kpy-git-info" title={repo.remoteUrl ?? 'No remote'}>
        {repo.busy ? (
          <>
            <LoaderCircle size={13} className="k-spin" /> {repo.busy}
          </>
        ) : repo.error ? (
          <span className="kpy-err">{repo.error}</span>
        ) : (
          <>
            {current ? `On ${current}` : 'Detached HEAD'}
            {ab && (ab.ahead || ab.behind) ? ` · ↑${ab.ahead} ↓${ab.behind} vs ${ab.upstream}` : ab ? ` · up to date with ${ab.upstream}` : ''}
            {!repo.files.length && repo.loaded ? ' · clean' : ''}
            {!repo.remoteUrl && ' · no remote'}
          </>
        )}
      </div>
    </div>
  )
}
