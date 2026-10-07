// The Git state of the open project, kept fresh: after this window's (or any
// window's) git operations, and shortly after files change on the drive.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { os, fs, path } from '@/os'
import * as git from '@/os/services/git'

export interface RepoState {
  /** The repository's folder (the project or one of its parents), or null. */
  root: string | null
  files: git.FileStatus[]
  branches: git.Branches | null
  remoteUrl: string | null
  ab: git.AheadBehind | null
  /** Bumped after every refresh, for views that fetch more (the log). */
  version: number
  loaded: boolean
  error: string | null
  /** What a long operation is doing ("Pulling…"), or null. */
  busy: string | null
}

export type StatusCode = 'added' | 'modified' | 'deleted' | 'untracked'

export interface RunOptions {
  /** Don't show a dialog for errors (the status bar still says what went wrong). */
  quiet?: boolean
  onError?: (err: unknown) => void | Promise<void>
}

export interface Repo extends RepoState {
  refresh(): void
  /** Run a git operation with a busy label; errors are shown to the user (or handed to onError). Resolves to undefined on failure. */
  run<T>(label: string, op: () => Promise<T>, opts?: RunOptions): Promise<T | undefined>
  /** Absolute path → status, for colouring the project tree (folders: 'modified' if they contain changes). */
  statusOf(absPath: string): StatusCode | null
}

const EMPTY: RepoState = { root: null, files: [], branches: null, remoteUrl: null, ab: null, version: 0, loaded: false, error: null, busy: null }

export function useRepo(projectRoot: string, status: (msg: string) => void): Repo {
  const [state, setState] = useState<RepoState>(() => ({ ...EMPTY, root: git.findRoot(projectRoot) }))
  const live = useRef(state)
  live.current = state
  const refreshing = useRef<Promise<void> | null>(null)
  const again = useRef(false)
  const project = useRef(projectRoot)
  project.current = projectRoot

  // The repository root can change: another project, `git init`, a deleted .git…
  const recheckRoot = useCallback(() => {
    const root = git.findRoot(project.current)
    if (root !== live.current.root) setState({ ...EMPTY, root })
    return root
  }, [])

  const doRefresh = useCallback(async () => {
    const root = recheckRoot()
    if (!root) {
      setState((s) => ({ ...s, loaded: true, files: [], branches: null, remoteUrl: null, ab: null, error: null }))
      return
    }
    try {
      const [files, branches, remoteUrl, ab] = await Promise.all([
        git.status(root),
        git.branches(root),
        git.getRemoteUrl(root),
        git.aheadBehind(root).catch(() => null),
      ])
      if (git.findRoot(project.current) !== root) return // the project changed meanwhile
      setState((s) => ({ ...s, root, files, branches, remoteUrl, ab, loaded: true, error: null, version: s.version + 1 }))
    } catch (e) {
      setState((s) => ({ ...s, loaded: true, error: git.describeGitError(e), version: s.version + 1 }))
    }
  }, [recheckRoot])

  /** One refresh at a time; asking during one runs another right after (always for the current project). */
  const refresh = useCallback(() => {
    if (refreshing.current) {
      again.current = true
      return
    }
    const loop = async () => {
      do {
        again.current = false
        await doRefresh()
      } while (again.current)
      refreshing.current = null
    }
    refreshing.current = loop()
  }, [doRefresh])

  useEffect(() => {
    setState({ ...EMPTY, root: git.findRoot(projectRoot) })
    refresh()
  }, [projectRoot, refresh])

  // Files changing in the project (not inside .git: our own operations announce themselves).
  useEffect(() => {
    let timer: number | undefined
    const later = (ms: number) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, ms)
    }
    const offFs = fs.watch((ev) => {
      const root = live.current.root ?? projectRoot
      const touched = [ev.path, ev.type === 'rename' ? ev.oldPath : null].filter(Boolean) as string[]
      if (!touched.some((p) => path.isInside(p, root) || path.isInside(root, p))) return
      if (touched.every((p) => /\/\.git(\/|$)/.test(p.slice(root.length)))) {
        // .git itself appearing or going away changes what the project is
        if (touched.some((p) => p === `${projectRoot}/.git` || p === `${root}/.git`)) later(100)
        return
      }
      later(600)
    })
    const offGit = git.onChange((ev) => {
      const root = live.current.root
      if (root && (ev.dir === root || path.isInside(ev.dir, root))) later(30)
      else if (!root && path.isInside(ev.dir, projectRoot)) later(30)
    })
    return () => {
      offFs()
      offGit()
      window.clearTimeout(timer)
    }
  }, [projectRoot, refresh])

  const run = useCallback(
    async <T,>(label: string, op: () => Promise<T>, opts: RunOptions = {}): Promise<T | undefined> => {
      setState((s) => ({ ...s, busy: label }))
      status(label)
      try {
        return await op()
      } catch (e) {
        const msg = git.describeGitError(e)
        status(msg)
        setState((s) => ({ ...s, busy: null }))
        if (opts.onError) await opts.onError(e)
        else if (!opts.quiet) await os.dialog.alert(msg, { title: label.replace(/…$/, '') })
        return undefined
      } finally {
        setState((s) => ({ ...s, busy: null }))
        refresh()
      }
    },
    [refresh, status],
  )

  const statusMap = useMemo(() => {
    const files = new Map<string, StatusCode>()
    const dirs = new Set<string>()
    const root = state.root
    if (!root) return { files, dirs }
    for (const f of state.files) {
      const code: StatusCode =
        f.unstaged === '?' && f.staged === ' ' ? 'untracked'
        : f.staged === 'A' ? 'added'
        : f.unstaged === 'D' || f.staged === 'D' ? 'deleted'
        : 'modified'
      const abs = `${root}/${f.path}`
      files.set(abs, code)
      for (let d = path.dirname(abs); d.length > root.length; d = path.dirname(d)) dirs.add(d)
    }
    return { files, dirs }
  }, [state.files, state.root])

  const statusOf = useCallback(
    (abs: string): StatusCode | null => statusMap.files.get(abs) ?? (statusMap.dirs.has(abs) ? 'modified' : null),
    [statusMap],
  )

  return { ...state, refresh, run, statusOf }
}
