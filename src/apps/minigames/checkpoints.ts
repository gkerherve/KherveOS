// Checkpoints for the longer games (Rune Keep, Last Train): the state at the
// start of the last level or station reached, so dying or closing the window
// doesn't send you back to the very beginning. Kept in this browser
// (localStorage); every access is guarded, a blocked storage just means no
// continuing after the window closes (the open window still remembers).

const PREFIX = 'kherveos.minigames.checkpoint.'
const memory = new Map<string, unknown>()

export function loadCheckpoint<T>(game: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + game)
    if (raw) return JSON.parse(raw) as T
  } catch {
    // unreadable: fall back to this session's copy
  }
  return (memory.get(game) as T | undefined) ?? null
}

export function saveCheckpoint<T>(game: string, data: T) {
  memory.set(game, data)
  try {
    globalThis.localStorage?.setItem(PREFIX + game, JSON.stringify(data))
  } catch {
    // storage full or blocked: kept for this session only
  }
}

export function clearCheckpoint(game: string) {
  memory.delete(game)
  try {
    globalThis.localStorage?.removeItem(PREFIX + game)
  } catch {
    // ignore
  }
}
