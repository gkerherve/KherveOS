// High scores, kept in this browser (localStorage). Every access is wrapped in
// try/catch: storage can be full, switched off or blocked (private windows).
// An in-memory copy keeps the session's scores even then, and tells every open
// game window when the table changes.

export interface HighScore {
  name: string
  score: number
  /** A few words about the game, e.g. "Level 4 · 32 lines". */
  summary: string
  /** When it was set (ms since 1970). */
  date: number
}

export const MAX_SCORES = 10
export const DEFAULT_NAME = 'Player'
const PREFIX = 'kherveos.minigames.'

const cache = new Map<string, HighScore[]>()
const listeners = new Set<() => void>()
let watching = false

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isScore(v: unknown): v is HighScore {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return (
    typeof s.name === 'string' &&
    typeof s.score === 'number' && Number.isFinite(s.score) &&
    typeof s.summary === 'string' &&
    typeof s.date === 'number'
  )
}

function read(game: string): HighScore[] {
  try {
    const raw = storage()?.getItem(`${PREFIX}${game}.scores`)
    if (!raw) return []
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter(isScore).sort((a, b) => b.score - a.score).slice(0, MAX_SCORES)
  } catch {
    return []
  }
}

function write(game: string, list: HighScore[]) {
  try {
    storage()?.setItem(`${PREFIX}${game}.scores`, JSON.stringify(list))
  } catch {
    // Full or blocked: the session copy still has it.
  }
}

function notify() {
  for (const fn of listeners) fn()
}

/** The table for a game, best first. The same array until it changes. */
export function getScores(game: string): HighScore[] {
  let list = cache.get(game)
  if (!list) {
    list = read(game)
    cache.set(game, list)
  }
  return list
}

/** Where `score` would rank (0 = top), or -1 if it doesn't make the table. */
export function rankOf(game: string, score: number): number {
  if (!(score > 0)) return -1
  const list = getScores(game)
  const i = list.findIndex((s) => score > s.score)
  if (i >= 0) return i
  return list.length < MAX_SCORES ? list.length : -1
}

/** Adds a score; returns its rank (0 = top), or -1 if it didn't make the table. */
export function addScore(game: string, entry: HighScore): number {
  const rank = rankOf(game, entry.score)
  if (rank < 0) return -1
  const name = entry.name.trim().slice(0, 16) || DEFAULT_NAME
  const list = [...getScores(game)]
  list.splice(rank, 0, { ...entry, name })
  if (list.length > MAX_SCORES) list.length = MAX_SCORES
  cache.set(game, list)
  write(game, list)
  notify()
  return rank
}

export function clearScores(game: string) {
  cache.set(game, [])
  try {
    storage()?.removeItem(`${PREFIX}${game}.scores`)
  } catch {
    // ignore
  }
  notify()
}

/** Calls `fn` whenever a table changes (here, or in another tab). */
export function subscribeScores(fn: () => void): () => void {
  if (!watching && typeof window !== 'undefined') {
    watching = true
    window.addEventListener('storage', (e) => {
      if (e.key === null || e.key.startsWith(PREFIX)) {
        cache.clear()
        notify()
      }
    })
  }
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** The name typed for the last high score, offered again next time. */
export function lastName(): string {
  try {
    return storage()?.getItem(`${PREFIX}name`) ?? ''
  } catch {
    return ''
  }
}

export function rememberName(name: string) {
  try {
    storage()?.setItem(`${PREFIX}name`, name)
  } catch {
    // ignore
  }
}
