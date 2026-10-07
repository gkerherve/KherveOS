// GitHub's REST API (who am I, my repositories, fork). api.github.com allows
// browsers (CORS), so these go straight there with the user's token — unlike
// git's own traffic, which goes through the KherveOS server's proxy.

const API = 'https://api.github.com'

export interface GithubUser {
  id: number
  login: string
  name: string | null
  email: string | null
  avatar_url: string
  html_url: string
}

export interface GithubRepo {
  id: number
  name: string
  full_name: string
  description: string | null
  private: boolean
  fork: boolean
  clone_url: string
  html_url: string
  default_branch: string
  pushed_at: string | null
  owner: { login: string }
}

async function call<T>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  } catch {
    throw new Error('GitHub is not reachable. Check your internet connection.')
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? res.statusText
    if (res.status === 401) throw new Error('GitHub refused the token (it may have expired or been revoked).')
    throw new Error(`GitHub: ${message} (${res.status})`)
  }
  return data as T
}

/** The account a token belongs to (also tests the token). */
export function githubUser(token: string): Promise<GithubUser> {
  return call<GithubUser>('/user', token)
}

/** Repositories the token can reach, most recently pushed first. */
export function githubRepos(token: string): Promise<GithubRepo[]> {
  return call<GithubRepo[]>('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', token)
}

/** "https://github.com/owner/repo(.git)", "git@github.com:owner/repo" or "owner/repo" → { owner, repo }. */
export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m ? { owner: m[1], repo: m[2] } : null
}

/** Fork a repository into the token's account. GitHub creates it in the background (a few seconds). */
export function githubFork(url: string, token: string): Promise<GithubRepo> {
  const parsed = parseGithubRepo(url)
  if (!parsed) return Promise.reject(new Error('That isn’t a GitHub repository URL (https://github.com/owner/repo).'))
  return call<GithubRepo>(`/repos/${parsed.owner}/${parsed.repo}/forks`, token, { method: 'POST', body: {} })
}

/** The address GitHub accepts for commits without revealing a real email. */
export function noreplyEmail(user: Pick<GithubUser, 'id' | 'login'>): string {
  return `${user.id}+${user.login}@users.noreply.github.com`
}

export const CREATE_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=KherveOS'
