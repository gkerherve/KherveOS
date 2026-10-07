// The Git service, independent of the browser: isomorphic-git over any drive
// (git.ts binds it to the KherveOS drive and the server's CORS proxy; tests
// bind it to an in-memory drive). Every function takes the repository's
// working folder (`dir`, absolute) first; paths inside it use "/".

import git from 'isomorphic-git'
import type { GitAuth, HttpClient, ReadCommitResult, WalkerEntry } from 'isomorphic-git'
import { createGitFs, type GitDrive } from './gitfs'
import { isBinary, unifiedDiff } from './diff'

// ------------------------------------------------------------------- types

export interface GitServiceOptions {
  drive: GitDrive
  http: HttpClient
  /** Prefix for remote URLs (isomorphic-git's corsProxy), e.g. '/api/git/proxy'. */
  corsProxy?: string
}

export interface Progress {
  phase: string
  loaded: number
  total: number
}

/** Options of everything that talks to a remote. */
export interface NetOptions {
  /** A GitHub token. Only ever sent to github.com. */
  token?: string
  /** The GitHub login that owns the token (any name works; defaults to x-access-token). */
  username?: string
  /** Remote name (default: the branch's upstream remote, else "origin"). */
  remote?: string
  onProgress?: (p: Progress) => void
  /** Lines the server prints ("remote: …"). */
  onMessage?: (line: string) => void
}

export interface Identity {
  name: string
  email: string
}

/** Index vs HEAD: ' ' same, A added, M modified, D deleted. */
export type StagedCode = ' ' | 'A' | 'M' | 'D'
/** Working tree vs index: ' ' same, M modified, D deleted, ? untracked. */
export type WorktreeCode = ' ' | 'M' | 'D' | '?'

export interface FileStatus {
  /** Relative to the repository, "/"-separated. */
  path: string
  staged: StagedCode
  unstaged: WorktreeCode
  /** e.g. "modified", "added (staged)", "untracked". */
  label: string
  /** isomorphic-git's statusMatrix row: [HEAD, WORKDIR, STAGE]. */
  matrix: [number, number, number]
}

export type RefKind = 'head' | 'branch' | 'remote' | 'tag'
export interface RefLabel {
  name: string
  kind: RefKind
}

export interface CommitInfo {
  oid: string
  short: string
  parents: string[]
  /** First line of the message. */
  subject: string
  message: string
  author: { name: string; email: string; time: number }
  committer: { name: string; email: string; time: number }
  /** Branches, remote branches, tags and HEAD pointing at this commit. */
  refs: RefLabel[]
}

export interface Branches {
  /** null when HEAD is detached. */
  current: string | null
  local: string[]
  /** "origin/main"… */
  remote: string[]
}

export type ChangeKind = 'A' | 'M' | 'D'
export interface ChangedFile {
  path: string
  status: ChangeKind
}

export type DiffSide = 'HEAD' | 'INDEX' | 'WORKDIR'
export interface FileDiff {
  path: string
  binary: boolean
  /** null: the file doesn't exist on that side. */
  oldText: string | null
  newText: string | null
  /** Unified diff ("" when identical). */
  patch: string
}

export interface AheadBehind {
  upstream: string
  ahead: number
  behind: number
}

export interface PullResult {
  /** Nothing new on the remote. */
  upToDate: boolean
  fastForward: boolean
  mergeCommit: boolean
  oid: string | null
}

/** A failure explained in plain words. `code` is isomorphic-git's error code when there was one. */
export class GitError extends Error {
  code: string
  data: unknown
  constructor(message: string, code = 'GitError', data: unknown = null) {
    super(message)
    this.name = 'GitError'
    this.code = code
    this.data = data
  }
}

// ----------------------------------------------------------------- helpers

const decoder = new TextDecoder()
const NAMES: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', '?': 'untracked' }

function statusCodes(head: number, workdir: number, stage: number): [StagedCode, WorktreeCode] {
  let x: StagedCode = ' '
  if (head === 0 && stage !== 0) x = 'A'
  else if (head === 1 && stage === 0) x = 'D'
  else if (head === 1 && (stage === 3 || (stage === 2 && workdir === 2))) x = 'M'
  let y: WorktreeCode = ' '
  if (stage === 0) y = workdir !== 0 ? '?' : ' '
  else if (workdir === 0) y = 'D'
  else if (stage === 1) y = workdir === 2 ? 'M' : ' '
  else if (stage === 3) y = 'M'
  return [x, y]
}

function statusLabel(x: StagedCode, y: WorktreeCode): string {
  const parts: string[] = []
  if (x !== ' ') parts.push(`${NAMES[x]} (staged)`)
  if (y !== ' ') parts.push(NAMES[y])
  return parts.join(', ')
}

function toList(paths: string | string[]): string[] {
  return (Array.isArray(paths) ? paths : [paths]).map((p) => p.replace(/^\/+/, '')).filter(Boolean)
}

function join(dir: string, rel: string): string {
  return `${dir.replace(/\/+$/, '')}/${rel}`
}

function person(p: { name: string; email: string; timestamp: number }) {
  return { name: p.name, email: p.email, time: p.timestamp * 1000 }
}

function toCommitInfo(c: ReadCommitResult, refs: Map<string, RefLabel[]>): CommitInfo {
  const message = c.commit.message.replace(/\s+$/, '')
  return {
    oid: c.oid,
    short: c.oid.slice(0, 7),
    parents: c.commit.parent,
    subject: message.split('\n', 1)[0],
    message,
    author: person(c.commit.author),
    committer: person(c.commit.committer ?? c.commit.author),
    refs: refs.get(c.oid) ?? [],
  }
}

function isGithub(url: string): boolean {
  return /^https?:\/\/([^/@]*@)?github\.com(?::443)?(\/|$)/i.test(url)
}

/**
 * "user/repo", "github.com/user/repo", "git@github.com:user/repo.git" or a
 * full https URL → an https clone URL.
 */
export function normalizeRepoUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '')
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/.exec(url)
  if (ssh) url = `https://${ssh[1]}/${ssh[2]}`
  else if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`
  else if (!/^[a-z]+:\/\//i.test(url)) url = `https://${url}`
  return url.replace(/^http:\/\/(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)\//i, 'https://$1/')
}

/** "https://github.com/me/my-repo.git" → "my-repo". */
export function repoNameFromUrl(url: string): string {
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? ''
  return last.replace(/\.git$/i, '') || 'repository'
}

/** A 401/403 from the Git host, explained (the KherveOS proxy's own answers pass through). */
function explainRemoteError(err: unknown, triedToken: boolean): unknown {
  const e = err as { code?: string; data?: { statusCode?: number; response?: unknown } } | null
  if (e?.code !== 'HttpError') return err
  if (/"detail"\s*:/.test(String(e.data?.response ?? ''))) return err
  const status = Number(e.data?.statusCode)
  if (status === 401) {
    return triedToken
      ? new GitError('GitHub refused your token, or it can’t reach this repository. Check it in Git › GitHub Token… (it needs the “repo” scope).', 'AuthFailed', e.data)
      : new GitError('This needs a login: the repository is private (or doesn’t exist), or you are pushing. Set a GitHub token in Git › GitHub Token….', 'AuthRequired', e.data)
  }
  if (status === 403) {
    return new GitError(
      triedToken
        ? 'Permission denied: your token can’t write to this repository (it needs the “repo” scope and push access).'
        : 'Permission denied by the Git server. Set a GitHub token in Git › GitHub Token….',
      'Forbidden',
      e.data,
    )
  }
  return err
}

/** A friendly sentence for anything a Git operation can throw. */
export function describeGitError(err: unknown): string {
  if (err instanceof GitError) return err.message
  const e = err as { code?: string; message?: string; data?: Record<string, unknown> } | null
  const code = e?.code ?? ''
  const data = (e?.data ?? {}) as Record<string, unknown>
  const msg = e?.message ?? String(err)
  switch (code) {
    case 'HttpError': {
      const status = Number(data.statusCode)
      const body = String(data.response ?? '')
      const detail = /"detail"\s*:\s*"([^"]+)"/.exec(body)?.[1]
      if (detail) return detail // from the KherveOS Git proxy
      if (status === 401) return 'The server needs a login: set a GitHub token (Git › GitHub Token…).'
      if (status === 403) return 'Permission denied. Check that your GitHub token has the “repo” scope and access to this repository.'
      if (status === 404) return 'Repository not found. Check the URL — or, if it is private, set a GitHub token.'
      if (status === 413) return 'Too large for the Git proxy.'
      if (status === 502 || status === 503 || status === 504) return 'The Git server could not be reached (through the KherveOS server). Try again later.'
      return `The Git server answered ${status} ${String(data.statusMessage ?? '')}.`.trim()
    }
    case 'NotFoundError':
      return `Could not find ${String(data.what ?? 'that')}.`
    case 'CheckoutConflictError': {
      const files = (data.filepaths as string[] | undefined) ?? []
      return `Your changes to ${files.slice(0, 5).join(', ')}${files.length > 5 ? '…' : ''} would be overwritten. Commit them first.`
    }
    case 'MergeConflictError':
    case 'MergeNotSupportedError': {
      const files = (data.filepaths as string[] | undefined) ?? []
      return `Both sides changed the same lines${files.length ? ` in ${files.slice(0, 5).join(', ')}` : ''}. KhervePY can't merge that automatically — nothing was changed.`
    }
    case 'FastForwardError':
      return 'The branch has diverged from the remote; a fast-forward was not possible.'
    case 'PushRejectedError':
      return data.reason === 'tag-exists'
        ? 'That tag already exists on the remote.'
        : 'The remote has commits you don’t have yet. Pull first, then push.'
    case 'MissingNameError':
      return 'Set your name and email for commits first (Git › Identity…).'
    case 'AlreadyExistsError':
      return `${String(data.noun ?? 'It')} “${String(data.where ?? '')}” already exists.`
    case 'InvalidRefNameError':
      return `“${String(data.ref)}” isn’t a valid branch name${data.suggestion ? ` — try “${String(data.suggestion)}”` : ''}.`
    case 'UrlParseError':
    case 'UnknownTransportError':
      return 'That doesn’t look like a Git URL (expected https://github.com/owner/repo).'
    case 'SmartHttpError':
      return 'The server didn’t answer like a Git server. Check the URL.'
    case 'UserCanceledError':
      return 'Cancelled.'
    case 'EmptyServerResponseError':
      return 'The Git server sent an empty answer.'
    case 'NoRefspecError':
      return `The remote “${String(data.remote)}” is not set up for fetching.`
  }
  if (err instanceof TypeError && /fetch|network|load failed/i.test(msg)) {
    return 'The KherveOS server is not reachable — GitHub is reached through it.'
  }
  return msg.replace(/^Error:\s*/, '')
}

// ------------------------------------------------------------------ service

export function createGitService({ drive, http, corsProxy }: GitServiceOptions) {
  const fs = createGitFs(drive)
  const caches = new Map<string, object>()
  const listeners = new Set<(ev: { dir: string; op: string }) => void>()

  /** isomorphic-git's object cache (parsed packfiles…), one per repository. */
  const cacheFor = (dir: string) => {
    let c = caches.get(dir)
    if (!c) {
      if (caches.size > 8) caches.delete(caches.keys().next().value!)
      caches.set(dir, (c = {}))
    }
    return c
  }
  const base = (dir: string) => ({ fs, dir, cache: cacheFor(dir) })
  const changed = (dir: string, op: string) => {
    for (const l of [...listeners]) {
      try {
        l({ dir, op })
      } catch (e) {
        console.error('[git] listener failed', e)
      }
    }
  }

  /**
   * Run a remote operation. isomorphic-git asks onAuth for credentials after a
   * 401; the token goes to github.com only. A 401/403 is then explained
   * according to whether the token was tried.
   */
  async function remoteCall<T>(opts: NetOptions, run: (args: ReturnType<typeof netArgs>) => Promise<T>): Promise<T> {
    const tried = { token: false }
    try {
      return await run(netArgs(opts, tried))
    } catch (err) {
      throw explainRemoteError(err, tried.token)
    }
  }

  const netArgs = (opts: NetOptions, tried: { token: boolean }) => ({
    http,
    corsProxy,
    onAuth: (url: string): GitAuth | void => {
      if (opts.token && isGithub(url)) {
        tried.token = true
        return { username: opts.username || 'x-access-token', password: opts.token }
      }
    },
    // A refused token: stop (isomorphic-git then reports the HTTP 401).
    onAuthFailure: (): GitAuth | void => undefined,
    onProgress: opts.onProgress,
    onMessage: opts.onMessage ? (m: string) => opts.onMessage!(m.replace(/\r?\n$/, '')) : undefined,
  })

  // ---------------------------------------------------------------- repo

  /** The repository folder containing `path` (it or a parent has a .git folder), or null. */
  function findRoot(path: string): string | null {
    let p = path.replace(/\/+$/, '') || '/'
    for (;;) {
      if (drive.stat(join(p, '.git'))?.type === 'dir') return p
      if (p === '/' || !p) return null
      p = p.slice(0, p.lastIndexOf('/')) || '/'
    }
  }

  function isRepo(dir: string): boolean {
    return drive.stat(join(dir, '.git'))?.type === 'dir'
  }

  async function init(dir: string, opts: { defaultBranch?: string } = {}): Promise<void> {
    await git.init({ fs, dir, defaultBranch: opts.defaultBranch ?? 'main' })
    changed(dir, 'init')
  }

  async function clone(
    url: string,
    dir: string,
    opts: NetOptions & { singleBranch?: boolean; depth?: number; ref?: string } = {},
  ): Promise<void> {
    const remoteUrl = normalizeRepoUrl(url)
    const existing = drive.stat(dir)
    if (existing && (existing.type !== 'dir' || drive.list(dir).length)) {
      throw new GitError(`“${dir}” already exists and isn’t an empty folder.`, 'Exists')
    }
    const created: string[] = []
    if (!existing) {
      // mkdir -p, remembering what to remove if the clone fails
      const parts = dir.split('/').filter(Boolean)
      for (let i = 1; i <= parts.length; i++) {
        const p = '/' + parts.slice(0, i).join('/')
        if (!drive.stat(p)) {
          await drive.mkdir(p)
          created.push(p)
        }
      }
    }
    try {
      await remoteCall(opts, (n) =>
        git.clone({
          ...base(dir),
          ...n,
          url: remoteUrl,
          ref: opts.ref,
          singleBranch: opts.singleBranch ?? false,
          depth: opts.depth,
        }),
      )
    } catch (err) {
      if (created.length) await drive.remove(created[0], { recursive: true }).catch(() => {})
      else for (const s of drive.list(dir)) await drive.remove(s.path, { recursive: true }).catch(() => {})
      throw err
    }
    changed(dir, 'clone')
  }

  // -------------------------------------------------------------- status

  async function status(dir: string): Promise<FileStatus[]> {
    const rows = await git.statusMatrix(base(dir))
    const out: FileStatus[] = []
    for (const [path, h, w, s] of rows) {
      if (h === 1 && w === 1 && s === 1) continue
      const [x, y] = statusCodes(h, w, s)
      if (x === ' ' && y === ' ') continue
      out.push({ path, staged: x, unstaged: y, label: statusLabel(x, y), matrix: [h, w, s] })
    }
    return out
  }

  /** Stage files (git add): new and changed files are added, missing ones are staged as deleted. */
  async function add(dir: string, paths: string | string[]): Promise<void> {
    for (const p of toList(paths)) {
      if (drive.stat(join(dir, p))) await git.add({ ...base(dir), filepath: p })
      else await git.remove({ ...base(dir), filepath: p })
    }
    changed(dir, 'add')
  }

  /** Take files out of the index (git rm --cached): the files stay on the drive. */
  async function remove(dir: string, paths: string | string[]): Promise<void> {
    for (const p of toList(paths)) await git.remove({ ...base(dir), filepath: p })
    changed(dir, 'remove')
  }

  /** Unstage (git restore --staged): the index entry goes back to HEAD's version. */
  async function unstage(dir: string, paths: string | string[]): Promise<void> {
    for (const p of toList(paths)) await git.resetIndex({ ...base(dir), filepath: p })
    changed(dir, 'unstage')
  }

  /** git add -A */
  async function stageAll(dir: string): Promise<number> {
    const files = (await status(dir)).filter((f) => f.unstaged !== ' ')
    for (const f of files) {
      if (f.unstaged === 'D') await git.remove({ ...base(dir), filepath: f.path })
      else await git.add({ ...base(dir), filepath: f.path })
    }
    changed(dir, 'add')
    return files.length
  }

  async function unstageAll(dir: string): Promise<number> {
    const files = (await status(dir)).filter((f) => f.staged !== ' ')
    for (const f of files) await git.resetIndex({ ...base(dir), filepath: f.path })
    changed(dir, 'unstage')
    return files.length
  }

  // -------------------------------------------------------------- commit

  async function commit(dir: string, opts: { message: string; author?: Identity | null }): Promise<string> {
    const message = opts.message.trim()
    if (!message) throw new GitError('Write a commit message first.', 'EmptyMessage')
    const staged = (await status(dir)).filter((f) => f.staged !== ' ')
    if (!staged.length) throw new GitError('Nothing to commit — stage some changes first.', 'NothingToCommit')
    const author = opts.author ?? (await configIdentity(dir))
    if (!author?.name || !author.email) throw new GitError('Set your name and email for commits first (Git › Identity…).', 'MissingNameError')
    const oid = await git.commit({ ...base(dir), message: message + '\n', author: { name: author.name, email: author.email } })
    changed(dir, 'commit')
    return oid
  }

  async function configIdentity(dir: string): Promise<Identity | null> {
    const name = await getConfig(dir, 'user.name')
    const email = await getConfig(dir, 'user.email')
    return name && email ? { name, email } : null
  }

  // ----------------------------------------------------------------- log

  async function resolve(dir: string, ref: string): Promise<string | null> {
    try {
      return await git.resolveRef({ fs, dir, ref })
    } catch {
      return null
    }
  }

  /** oid → the refs pointing at it (for the log's decorations). */
  async function refLabels(dir: string): Promise<Map<string, RefLabel[]>> {
    const map = new Map<string, RefLabel[]>()
    const put = (oid: string | null, label: RefLabel) => {
      if (!oid) return
      const list = map.get(oid) ?? []
      list.push(label)
      map.set(oid, list)
    }
    const current = (await git.currentBranch({ fs, dir })) ?? null
    if (current) put(await resolve(dir, `refs/heads/${current}`), { name: current, kind: 'head' })
    else put(await resolve(dir, 'HEAD'), { name: 'HEAD', kind: 'head' })
    for (const b of await git.listBranches({ fs, dir })) {
      if (b !== current) put(await resolve(dir, `refs/heads/${b}`), { name: b, kind: 'branch' })
    }
    for (const { remote } of await git.listRemotes({ fs, dir })) {
      for (const b of await git.listBranches({ fs, dir, remote })) {
        if (b !== 'HEAD') put(await resolve(dir, `refs/remotes/${remote}/${b}`), { name: `${remote}/${b}`, kind: 'remote' })
      }
    }
    for (const t of await git.listTags({ fs, dir })) {
      let oid = await resolve(dir, `refs/tags/${t}`)
      if (oid) {
        try {
          oid = (await git.readTag({ ...base(dir), oid })).tag.object // annotated: point at the commit
        } catch {
          /* lightweight tag */
        }
      }
      put(oid, { name: t, kind: 'tag' })
    }
    return map
  }

  /**
   * Recent commits, newest first (children always before parents).
   * `all`: every branch, remote branch and tag, like `git log --all --topo-order`.
   */
  async function log(dir: string, opts: { ref?: string; depth?: number; all?: boolean } = {}): Promise<CommitInfo[]> {
    const depth = opts.depth ?? 300
    const refs = await refLabels(dir)
    if (!opts.all) {
      if (!(await resolve(dir, opts.ref ?? 'HEAD'))) return [] // no commits yet
      const commits = await git.log({ ...base(dir), ref: opts.ref ?? 'HEAD', depth })
      return commits.map((c) => toCommitInfo(c, refs))
    }
    const head = await resolve(dir, 'HEAD')
    const tips = new Set<string>([...(head ? [head] : []), ...refs.keys()])
    const seen = new Map<string, ReadCommitResult>()
    const frontier: ReadCommitResult[] = []
    const read = async (oid: string) => {
      if (seen.has(oid)) return
      try {
        const c = await git.readCommit({ ...base(dir), oid })
        seen.set(oid, c)
        frontier.push(c)
      } catch {
        /* not a commit, or cut off by a shallow clone */
      }
    }
    for (const oid of tips) await read(oid)
    const picked: ReadCommitResult[] = []
    while (frontier.length && picked.length < depth) {
      let best = 0
      for (let i = 1; i < frontier.length; i++) {
        if (frontier[i].commit.committer.timestamp > frontier[best].commit.committer.timestamp) best = i
      }
      const c = frontier.splice(best, 1)[0]
      picked.push(c)
      for (const p of c.commit.parent) await read(p)
    }
    return topoSort(picked).map((c) => toCommitInfo(c, refs))
  }

  /** Children before parents; among the ready ones, newest first. */
  function topoSort(commits: ReadCommitResult[]): ReadCommitResult[] {
    const inSet = new Map(commits.map((c) => [c.oid, c]))
    const children = new Map<string, number>()
    for (const c of commits) for (const p of c.commit.parent) if (inSet.has(p)) children.set(p, (children.get(p) ?? 0) + 1)
    const ready = commits.filter((c) => !children.get(c.oid))
    const out: ReadCommitResult[] = []
    while (ready.length) {
      let best = 0
      for (let i = 1; i < ready.length; i++) {
        if (ready[i].commit.committer.timestamp > ready[best].commit.committer.timestamp) best = i
      }
      const c = ready.splice(best, 1)[0]
      out.push(c)
      for (const p of c.commit.parent) {
        if (!inSet.has(p)) continue
        const n = (children.get(p) ?? 0) - 1
        children.set(p, n)
        if (n === 0) ready.push(inSet.get(p)!)
      }
    }
    return out
  }

  // ---------------------------------------------------------- file versions

  /** A file as it was in a commit (a ref such as "HEAD", a branch, or an oid); null if it wasn't there. */
  async function readFileAtCommit(dir: string, ref: string, filepath: string): Promise<Uint8Array | null> {
    const oid = await resolve(dir, ref)
    if (!oid) return null
    try {
      const { blob } = await git.readBlob({ ...base(dir), oid, filepath: filepath.replace(/^\/+/, '') })
      return blob
    } catch {
      return null
    }
  }

  async function readTextAtCommit(dir: string, ref: string, filepath: string): Promise<string | null> {
    const data = await readFileAtCommit(dir, ref, filepath)
    return data ? decoder.decode(data) : null
  }

  /** A file as it is staged; null if it isn't in the index. */
  async function readIndexFile(dir: string, filepath: string): Promise<Uint8Array | null> {
    const target = filepath.replace(/^\/+/, '')
    const found = (await git.walk({
      ...base(dir),
      trees: [git.STAGE()],
      map: async (p: string, [entry]: (WalkerEntry | null)[]) => {
        if (p === '.') return undefined
        if (p === target) return entry ? entry.oid() : undefined
        return target.startsWith(p + '/') ? undefined : null
      },
    })) as string[]
    const oid = found.find(Boolean)
    if (!oid) return null
    try {
      return (await git.readBlob({ ...base(dir), oid })).blob
    } catch {
      return null
    }
  }

  async function readSide(dir: string, side: DiffSide, filepath: string): Promise<Uint8Array | null> {
    if (side === 'HEAD') return readFileAtCommit(dir, 'HEAD', filepath)
    if (side === 'INDEX') return readIndexFile(dir, filepath)
    const full = join(dir, filepath)
    return drive.stat(full)?.type === 'file' ? drive.readBytes(full) : null
  }

  function makeDiff(path: string, a: Uint8Array | null, b: Uint8Array | null): FileDiff {
    if ((a && isBinary(a)) || (b && isBinary(b))) {
      const same = !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i])
      return { path, binary: true, oldText: null, newText: null, patch: same ? '' : `Binary files ${a ? `a/${path}` : '/dev/null'} and ${b ? `b/${path}` : '/dev/null'} differ\n` }
    }
    const oldText = a ? decoder.decode(a) : null
    const newText = b ? decoder.decode(b) : null
    return { path, binary: false, oldText, newText, patch: unifiedDiff(oldText, newText, { oldPath: path, newPath: path, gitHeader: true }) }
  }

  /** The diff of one file between two states — by default HEAD → working tree ("git diff HEAD -- file"). */
  async function diffFile(dir: string, filepath: string, opts: { from?: DiffSide; to?: DiffSide } = {}): Promise<FileDiff> {
    const path = filepath.replace(/^\/+/, '')
    const [a, b] = await Promise.all([readSide(dir, opts.from ?? 'HEAD', path), readSide(dir, opts.to ?? 'WORKDIR', path)])
    return makeDiff(path, a, b)
  }

  /** Files that differ between two commits (or trees). */
  async function changesBetween(dir: string, from: string | null, to: string): Promise<ChangedFile[]> {
    const trees = from ? [git.TREE({ ref: from }), git.TREE({ ref: to })] : [git.TREE({ ref: to })]
    const result = (await git.walk({
      ...base(dir),
      trees,
      map: async (p: string, entries: (WalkerEntry | null)[]) => {
        if (p === '.') return undefined
        const [a, b] = from ? entries : [null, entries[0]]
        const [ta, tb] = await Promise.all([a?.type(), b?.type()])
        const [oa, ob] = await Promise.all([a?.oid(), b?.oid()])
        if (ta === 'tree' && tb === 'tree') return oa === ob ? null : undefined // skip identical folders
        if (ta === 'tree' || tb === 'tree') {
          // a file became a folder (or back): report the file side
          if (ta === 'blob') return { path: p, status: 'D' as ChangeKind }
          if (tb === 'blob') return { path: p, status: 'A' as ChangeKind }
          return undefined
        }
        if (oa === ob) return undefined
        return { path: p, status: (!a ? 'A' : !b ? 'D' : 'M') as ChangeKind }
      },
    })) as ChangedFile[]
    return result.filter(Boolean).sort((x, y) => x.path.localeCompare(y.path))
  }

  /** What a commit changed, compared with its first parent. */
  async function commitChanges(dir: string, oid: string): Promise<ChangedFile[]> {
    const c = await git.readCommit({ ...base(dir), oid })
    return changesBetween(dir, c.commit.parent[0] ?? null, c.oid)
  }

  /** One file's diff in a commit, compared with its first parent. */
  async function diffCommitFile(dir: string, oid: string, filepath: string): Promise<FileDiff> {
    const c = await git.readCommit({ ...base(dir), oid })
    const parent = c.commit.parent[0]
    const [a, b] = await Promise.all([
      parent ? readFileAtCommit(dir, parent, filepath) : Promise.resolve(null),
      readFileAtCommit(dir, c.oid, filepath),
    ])
    return makeDiff(filepath, a, b)
  }

  // ------------------------------------------------------------ branches

  async function currentBranch(dir: string): Promise<string | null> {
    return (await git.currentBranch({ fs, dir })) ?? null
  }

  async function branches(dir: string): Promise<Branches> {
    const current = await currentBranch(dir)
    const local = await git.listBranches({ fs, dir })
    if (current && !local.includes(current)) local.unshift(current) // a new repo: HEAD names a branch with no commit yet
    const remote: string[] = []
    for (const { remote: r } of await git.listRemotes({ fs, dir })) {
      for (const b of await git.listBranches({ fs, dir, remote: r })) if (b !== 'HEAD') remote.push(`${r}/${b}`)
    }
    return { current, local: local.sort((a, b) => a.localeCompare(b)), remote: remote.sort((a, b) => a.localeCompare(b)) }
  }

  async function createBranch(dir: string, name: string, opts: { checkout?: boolean } = {}): Promise<void> {
    const ref = name.trim()
    if (!(await resolve(dir, 'HEAD'))) throw new GitError('Make a first commit before creating branches.', 'NoCommits')
    await git.branch({ fs, dir, ref, checkout: opts.checkout ?? true })
    changed(dir, 'branch')
  }

  /**
   * Switch branch. "origin/feature" checks out a local "feature" that tracks it
   * (created if needed). Local changes that would be overwritten stop it.
   */
  async function checkout(dir: string, ref: string): Promise<void> {
    let target = ref
    let remote: string | undefined
    const remotes = (await git.listRemotes({ fs, dir })).map((r) => r.remote)
    const slash = ref.indexOf('/')
    if (slash > 0 && remotes.includes(ref.slice(0, slash)) && !(await resolve(dir, `refs/heads/${ref}`))) {
      remote = ref.slice(0, slash)
      target = ref.slice(slash + 1)
    }
    await git.checkout({ ...base(dir), ref: target, remote: remote ?? 'origin' })
    changed(dir, 'checkout')
  }

  async function deleteBranch(dir: string, name: string): Promise<void> {
    await git.deleteBranch({ fs, dir, ref: name })
    changed(dir, 'branch')
  }

  // -------------------------------------------------------------- config

  async function getConfig(dir: string, path: string): Promise<string | null> {
    try {
      const v = await git.getConfig({ fs, dir, path })
      return v === undefined || v === null ? null : String(v)
    } catch {
      return null
    }
  }

  async function setConfig(dir: string, path: string, value: string | null): Promise<void> {
    await git.setConfig({ fs, dir, path, value: value ?? undefined })
    changed(dir, 'config')
  }

  async function getRemoteUrl(dir: string, remote = 'origin'): Promise<string | null> {
    return getConfig(dir, `remote.${remote}.url`)
  }

  async function setRemoteUrl(dir: string, url: string, remote = 'origin'): Promise<void> {
    const clean = normalizeRepoUrl(url)
    if (await getRemoteUrl(dir, remote)) await git.setConfig({ fs, dir, path: `remote.${remote}.url`, value: clean })
    else await git.addRemote({ fs, dir, remote, url: clean })
    changed(dir, 'config')
  }

  /** The upstream of the current branch: { remote, branch } from branch.<name>.remote / .merge. */
  async function upstreamOf(dir: string, branch: string): Promise<{ remote: string; branch: string } | null> {
    const remote = await getConfig(dir, `branch.${branch}.remote`)
    const merge = await getConfig(dir, `branch.${branch}.merge`)
    if (!remote || !merge) return null
    return { remote, branch: merge.replace(/^refs\/heads\//, '') }
  }

  /** How far the current branch is ahead of / behind its upstream (as last fetched). */
  async function aheadBehind(dir: string): Promise<AheadBehind | null> {
    const branch = await currentBranch(dir)
    if (!branch) return null
    const up = await upstreamOf(dir, branch)
    if (!up) return null
    const upstream = `${up.remote}/${up.branch}`
    const local = await resolve(dir, `refs/heads/${branch}`)
    const remote = await resolve(dir, `refs/remotes/${upstream}`)
    if (!local || !remote) return { upstream, ahead: 0, behind: 0 }
    if (local === remote) return { upstream, ahead: 0, behind: 0 }
    let mergeBase: string | null = null
    try {
      const bases = (await git.findMergeBase({ ...base(dir), oids: [local, remote] })) as string[]
      mergeBase = bases[0] ?? null
    } catch {
      /* unrelated histories */
    }
    const count = async (from: string) => {
      const seen = new Set<string>()
      const queue = [from]
      while (queue.length && seen.size < 1000) {
        const oid = queue.shift()!
        if (oid === mergeBase || seen.has(oid)) continue
        seen.add(oid)
        try {
          queue.push(...(await git.readCommit({ ...base(dir), oid })).commit.parent)
        } catch {
          /* shallow */
        }
      }
      return seen.size
    }
    return { upstream, ahead: await count(local), behind: await count(remote) }
  }

  // -------------------------------------------------------------- remotes

  async function remoteFor(dir: string, opts: NetOptions, branch: string | null): Promise<string> {
    if (opts.remote) return opts.remote
    const configured = branch ? await getConfig(dir, `branch.${branch}.remote`) : null
    const remote = configured ?? 'origin'
    if (!(await getRemoteUrl(dir, remote))) {
      throw new GitError(`This repository has no remote “${remote}”. Add one first (Git › Remote URL…).`, 'NoRemote')
    }
    return remote
  }

  async function fetch(dir: string, opts: NetOptions = {}): Promise<void> {
    const remote = await remoteFor(dir, opts, await currentBranch(dir))
    await remoteCall(opts, (n) => git.fetch({ ...base(dir), ...n, remote, tags: true }))
    changed(dir, 'fetch')
  }

  /**
   * Fetch, then bring the current branch up to date with its upstream
   * (fast-forward, or a merge commit by `author` when both sides moved).
   * Refuses — changing nothing — when local changes touch incoming files.
   */
  async function pull(dir: string, opts: NetOptions & { author?: Identity | null } = {}): Promise<PullResult> {
    const branch = await currentBranch(dir)
    if (!branch) throw new GitError('Check out a branch first (HEAD is detached).', 'DetachedHead')
    const remote = await remoteFor(dir, opts, branch)
    const up = await upstreamOf(dir, branch)
    const remoteBranch = up && up.remote === remote ? up.branch : branch
    let fetched: { fetchHead: string | null }
    try {
      fetched = await remoteCall(opts, (n) =>
        git.fetch({
          ...base(dir),
          ...n,
          remote,
          ref: remoteBranch,
          remoteRef: remoteBranch,
          singleBranch: true,
          tags: false,
        }),
      )
    } catch (err) {
      if ((err as { code?: string }).code === 'NotFoundError') {
        throw new GitError(`“${remote}” has no branch “${remoteBranch}” yet — push it first.`, 'NoUpstream')
      }
      throw err
    }
    changed(dir, 'fetch')
    const theirs = fetched.fetchHead
    if (!theirs) throw new GitError(`“${remote}” has no branch “${remoteBranch}” yet — push it first.`, 'NoUpstream')
    const ours = await resolve(dir, `refs/heads/${branch}`)
    const result: PullResult = { upToDate: false, fastForward: false, mergeCommit: false, oid: theirs }
    if (!ours) {
      // A fresh repository with no commit yet: take the remote's.
      await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: theirs, force: true })
      await git.checkout({ ...base(dir), ref: branch, force: false })
      changed(dir, 'pull')
      return { ...result, fastForward: true }
    }
    if (ours === theirs || (await git.isDescendent({ ...base(dir), oid: ours, ancestor: theirs, depth: -1 }))) {
      return { ...result, upToDate: true, oid: ours }
    }
    // Like git: local changes are fine unless the pull changes the same files.
    const incoming = new Set((await changesBetween(dir, ours, theirs)).map((c) => c.path))
    const clash = (await status(dir)).map((f) => f.path).filter((p) => incoming.has(p))
    if (clash.length) {
      throw new GitError(
        `Commit or undo your changes to ${clash.slice(0, 5).join(', ')}${clash.length > 5 ? ` and ${clash.length - 5} more` : ''} first: the pull changes ${clash.length === 1 ? 'that file' : 'those files'} too.`,
        'LocalChanges',
        { filepaths: clash },
      )
    }
    const fastForward = await git.isDescendent({ ...base(dir), oid: theirs, ancestor: ours, depth: -1 })
    const author = opts.author ?? (await configIdentity(dir))
    if (!fastForward && !author) {
      throw new GitError(
        'Your branch and the remote have both moved on, so the pull needs a merge commit: set your name and email first (Git › Identity…).',
        'MissingNameError',
      )
    }
    const merged = await git.merge({
      ...base(dir),
      ours: branch,
      theirs,
      fastForward: true,
      fastForwardOnly: fastForward,
      abortOnConflict: true,
      author: author ?? undefined,
      message: `Merge ${remote}/${remoteBranch} into ${branch}`,
    })
    await git.checkout({ ...base(dir), ref: branch })
    changed(dir, 'pull')
    return { upToDate: false, fastForward: !!merged.fastForward, mergeCommit: !!merged.mergeCommit, oid: merged.oid ?? null }
  }

  /** Push the current branch (or `ref`); sets it up to track the remote branch the first time. */
  async function push(dir: string, opts: NetOptions & { ref?: string; force?: boolean } = {}): Promise<void> {
    const branch = opts.ref ?? (await currentBranch(dir))
    if (!branch) throw new GitError('Check out a branch first (HEAD is detached).', 'DetachedHead')
    if (!(await resolve(dir, `refs/heads/${branch}`))) throw new GitError('Nothing to push yet — make a first commit.', 'NoCommits')
    const remote = await remoteFor(dir, opts, branch)
    const up = await upstreamOf(dir, branch)
    const remoteRef = up && up.remote === remote ? up.branch : branch
    const res = await remoteCall(opts, (n) => git.push({ ...base(dir), ...n, remote, ref: branch, remoteRef, force: !!opts.force }))
    const refResult = res.refs?.[`refs/heads/${remoteRef}`]
    if (!res.ok || (refResult && !refResult.ok)) {
      const why = refResult?.error ?? res.error ?? 'rejected'
      throw new GitError(/fast.?forward|fetch first|non-fast/i.test(why) ? 'The remote has commits you don’t have yet. Pull first, then push.' : `The remote refused the push: ${why}`, 'PushRejected')
    }
    if (!up) {
      await git.setConfig({ fs, dir, path: `branch.${branch}.remote`, value: remote })
      await git.setConfig({ fs, dir, path: `branch.${branch}.merge`, value: `refs/heads/${remoteRef}` })
    }
    changed(dir, 'push')
  }

  /** Be told after any change this service makes to a repository (commit, checkout, pull…). */
  function onChange(listener: (ev: { dir: string; op: string }) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  return {
    fs,
    findRoot,
    isRepo,
    init,
    clone,
    status,
    add,
    remove,
    unstage,
    stageAll,
    unstageAll,
    commit,
    configIdentity,
    log,
    readFileAtCommit,
    readTextAtCommit,
    readIndexFile,
    diffFile,
    changesBetween,
    commitChanges,
    diffCommitFile,
    currentBranch,
    branches,
    createBranch,
    checkout,
    deleteBranch,
    getConfig,
    setConfig,
    getRemoteUrl,
    setRemoteUrl,
    aheadBehind,
    fetch,
    pull,
    push,
    onChange,
  }
}

export type GitService = ReturnType<typeof createGitService>
