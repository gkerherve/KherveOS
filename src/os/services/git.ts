// The KherveOS Git service: isomorphic-git working on the virtual drive.
// Remote traffic (clone, fetch, pull, push) goes through the KherveOS
// server's CORS proxy (/api/git/proxy), which only reaches github.com,
// gitlab.com, bitbucket.org and codeberg.org.
//
//   import * as git from '@/os/services/git'
//
//   await git.clone('https://github.com/me/repo', `${HOME}/Projects/repo`, { token: git.getGithubToken() })
//   const files = await git.status(dir)               // [{ path, staged: 'M', unstaged: ' ', label }]
//   await git.add(dir, ['main.py'])
//   await git.commit(dir, { message: 'Fix the plot', author: await git.resolveIdentity(dir) })
//   await git.push(dir, { token: git.getGithubToken(), username: git.getGithubLogin() })
//   const d = await git.diffFile(dir, 'main.py')      // HEAD → working tree, d.patch is a unified diff
//
// Errors are isomorphic-git's (or GitError); git.describeGitError(err) turns
// any of them into a sentence for the user.
//
// The GitHub token lives in this browser's localStorage ('kherveos.github.token'),
// never in a repository: it is handed to isomorphic-git's onAuth and only
// ever sent to github.com.

import './buffer-shim'
import http from 'isomorphic-git/http/web'
import { fs as drive } from '../vfs'
import { createGitService, type Identity } from './gitcore'

export {
  GitError, describeGitError, normalizeRepoUrl, repoNameFromUrl,
} from './gitcore'
export type {
  AheadBehind, Branches, ChangeKind, ChangedFile, CommitInfo, DiffSide, FileDiff, FileStatus, GitService, Identity,
  NetOptions, Progress, PullResult, RefKind, RefLabel, StagedCode, WorktreeCode,
} from './gitcore'
export { githubUser, githubRepos, githubFork, parseGithubRepo, noreplyEmail, CREATE_TOKEN_URL } from './github'
export type { GithubUser, GithubRepo } from './github'
export { diffLines, unifiedDiff, lineMarkers, splitLines, isBinary } from './diff'
export type { DiffOp, LineMarkers } from './diff'

export const GIT_CORS_PROXY = '/api/git/proxy'

/** The service bound to the KherveOS drive (functions below are its methods). */
export const service = createGitService({ drive, http, corsProxy: GIT_CORS_PROXY })

export const {
  findRoot, isRepo, init, clone, status, add, remove, unstage, stageAll, unstageAll, commit, log,
  readFileAtCommit, readTextAtCommit, readIndexFile, diffFile, changesBetween, commitChanges, diffCommitFile,
  currentBranch, branches, createBranch, checkout, deleteBranch, getConfig, setConfig, getRemoteUrl,
  setRemoteUrl, aheadBehind, fetch, pull, push, onChange,
} = service

// ------------------------------------------------------- per-user settings

const TOKEN_KEY = 'kherveos.github.token'
const LOGIN_KEY = 'kherveos.github.user'
const IDENTITY_KEY = 'kherveos.git.identity'

function read(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* storage disabled: the value just isn't remembered */
  }
}

const settingsListeners = new Set<() => void>()
const notifySettings = () => settingsListeners.forEach((l) => l())
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY || e.key === LOGIN_KEY || e.key === IDENTITY_KEY) notifySettings()
  })
}

/** Called when the token, the GitHub login or the commit identity changes (in any window). */
export function onSettingsChange(listener: () => void): () => void {
  settingsListeners.add(listener)
  return () => settingsListeners.delete(listener)
}

/** The user's GitHub personal access token ('' when none). */
export function getGithubToken(): string {
  return read(TOKEN_KEY)
}

/** The GitHub login the token belongs to, once verified ('' when unknown). */
export function getGithubLogin(): string {
  return read(LOGIN_KEY)
}

/** Store (or, with null/'', forget) the token and the login it belongs to. */
export function setGithubToken(token: string | null, login: string | null = null): void {
  write(TOKEN_KEY, token?.trim() || null)
  write(LOGIN_KEY, token?.trim() ? login : null)
  notifySettings()
}

/** The name and email used for commits in every repository (like ~/.gitconfig). */
export function getGlobalIdentity(): Identity | null {
  try {
    const v = JSON.parse(read(IDENTITY_KEY) || 'null') as Identity | null
    return v?.name && v.email ? v : null
  } catch {
    return null
  }
}

export function setGlobalIdentity(identity: Identity | null): void {
  write(IDENTITY_KEY, identity ? JSON.stringify({ name: identity.name.trim(), email: identity.email.trim() }) : null)
  notifySettings()
}

/** Who commits in `dir`: the repository's user.name/user.email, else the global identity. */
export async function resolveIdentity(dir: string): Promise<Identity | null> {
  return (await service.configIdentity(dir)) ?? getGlobalIdentity()
}

/** The remote-access options for the stored token (pass to clone/fetch/pull/push). */
export function githubAuth(): { token?: string; username?: string } {
  const token = getGithubToken()
  return token ? { token, username: getGithubLogin() || undefined } : {}
}
