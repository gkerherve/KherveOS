import { useEffect, useState, useSyncExternalStore } from 'react'
import type { TypingEntry } from './store'

/** The current time, refreshed every `intervalMs`. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

const onVisibility = (cb: () => void) => {
  document.addEventListener('visibilitychange', cb)
  return () => document.removeEventListener('visibilitychange', cb)
}

/** False while the browser tab is hidden. */
export const usePageVisible = () => useSyncExternalStore(onVisibility, () => document.visibilityState === 'visible')

/** Names of the people still typing (entries expire on their own). */
export function activeTypers(entries: Record<number, TypingEntry> | undefined, now: number): string[] {
  if (!entries) return []
  return Object.values(entries)
    .filter((e) => e.until > now)
    .map((e) => e.name)
}
