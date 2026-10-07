// The embedded browsers of the Other Databases & Properties window: one per
// database tab, each with its own history. Pure (no React), so Node can test it.
//
// Like the desktop (src-tauri/src/references.rs): selecting another element
// re-points every tab at that element's page, and a tab that isn't visible
// only reloads when it is selected.

export interface Frame {
  /** The addresses this tab went through; `index` is the current one. */
  history: string[]
  index: number
  /** Bumped whenever the frame must load afresh (it keys the frame). */
  nav: number
  /** The address the frame was loaded with ('' before it was ever shown). */
  shown: string
  /** Frame loads since the last (re)load: 0 means the first page is still on its way. */
  loads: number
  loading: boolean
  /** Something the page could not do (a form, a bot check…). */
  notice: string | null
}

export type Frames = Record<string, Frame>

export function newFrame(url: string): Frame {
  return { history: [url], index: 0, nav: 0, shown: '', loads: 0, loading: false, notice: null }
}

function norm(url: string): string {
  try {
    return new URL(url).href
  } catch {
    return url
  }
}

const HISTORY_MAX = 50

/** Make the active tab's frame show its current entry (a fresh load when it shows something else). */
export function sync(frames: Frames, active: string): Frames {
  const f = frames[active]
  if (!f) return frames
  const want = f.history[f.index]
  if (f.shown === want) return frames
  return { ...frames, [active]: { ...f, shown: want, nav: f.nav + 1, loads: 0, loading: true, notice: null } }
}

/** A new element: every tab goes back to its page for that element (`homes`: tab id → address). */
export function follow(frames: Frames, homes: Record<string, string>, active: string): Frames {
  let next = frames
  for (const [id, home] of Object.entries(homes)) {
    const f = frames[id]
    if (f && f.history.length === 1 && f.history[0] === home) continue
    if (next === frames) next = { ...frames }
    next[id] = f ? { ...f, history: [home], index: 0 } : newFrame(home)
  }
  return sync(next, active)
}

/** Open `url` in tab `id` (a search, Home). */
export function go(frames: Frames, id: string, url: string, active: string): Frames {
  const f = frames[id]
  if (!f) return frames
  const history = [...f.history.slice(0, f.index + 1), url].slice(-HISTORY_MAX)
  return sync({ ...frames, [id]: { ...f, history, index: history.length - 1, shown: '' } }, active)
}

/** Back (-1) or forward (+1). */
export function step(frames: Frames, id: string, delta: number, active: string): Frames {
  const f = frames[id]
  if (!f || f.history[f.index + delta] === undefined) return frames
  return sync({ ...frames, [id]: { ...f, index: f.index + delta, shown: '' } }, active)
}

export function reload(frames: Frames, id: string): Frames {
  const f = frames[id]
  if (!f || !f.shown) return frames
  return { ...frames, [id]: { ...f, nav: f.nav + 1, loads: 0, loading: true, notice: null } }
}

/** The frame (load `nav` of tab `id`) finished loading a page. */
export function loaded(frames: Frames, id: string, nav: number): Frames {
  const f = frames[id]
  if (!f || f.nav !== nav) return frames
  return { ...frames, [id]: { ...f, loads: f.loads + 1, loading: false } }
}

/**
 * The page in the frame says where it is: after a redirect (its first page)
 * the entry is corrected; after a link was followed, it is a new entry. The
 * frame itself stays (`shown` follows, `nav` doesn't change).
 */
export function located(frames: Frames, id: string, nav: number, url: string): Frames {
  const f = frames[id]
  if (!f || f.nav !== nav || norm(f.history[f.index]) === norm(url)) return frames
  if (f.loads === 0) {
    const history = f.history.map((a, i) => (i === f.index ? url : a))
    return { ...frames, [id]: { ...f, history, shown: url } }
  }
  const history = [...f.history.slice(0, f.index + 1), url].slice(-HISTORY_MAX)
  return { ...frames, [id]: { ...f, history, index: history.length - 1, shown: url, notice: null } }
}

export function noticed(frames: Frames, id: string, nav: number, notice: string | null): Frames {
  const f = frames[id]
  if (!f || f.nav !== nav) return frames
  return { ...frames, [id]: { ...f, notice, loading: notice ? false : f.loading } }
}

export function busy(frames: Frames, id: string, nav: number): Frames {
  const f = frames[id]
  if (!f || f.nav !== nav) return frames
  return { ...frames, [id]: { ...f, loading: true } }
}
