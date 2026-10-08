// What kCode remembers: finished lessons, the code you wrote, the last lesson, practice days.
// The storage is injected (localStorage in the app, a Map in tests) and every access is
// guarded: a storage that is missing, full or blocked just means nothing is remembered.

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ProgressData {
  version: 1
  /** lesson id → time it was completed (ms since 1970). */
  done: Record<string, number>
  /** The lesson open when kCode was closed. */
  last: string | null
  /** lesson id → the learner's own code (only when it differs from the starter). */
  code: Record<string, string>
  /** Days (YYYY-MM-DD, local) on which the learner ran something. */
  days: string[]
  /** The scratchpad's text per language, and the language shown last. */
  scratch: { python: string; javascript: string; language: 'python' | 'javascript' }
}

export const PROGRESS_KEY = 'kcode.progress.v1'
export const PREFS_KEY = 'kcode.prefs.v1'
const MAX_DAYS = 400

export const emptyProgress = (): ProgressData => ({
  version: 1,
  done: {},
  last: null,
  code: {},
  days: [],
  scratch: { python: '', javascript: '', language: 'python' },
})

/** YYYY-MM-DD in local time. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + delta))
}

/** Consecutive practice days ending today (or yesterday: today may not have started yet), and the best run. */
export function streaks(days: string[], today: string): { current: number; best: number } {
  const set = new Set(days)
  let current = 0
  let cursor = set.has(today) ? today : shiftDay(today, -1)
  while (set.has(cursor)) {
    current++
    cursor = shiftDay(cursor, -1)
  }
  let best = 0
  for (const d of set) {
    if (set.has(shiftDay(d, -1))) continue // not the start of a run
    let n = 0
    for (let c = d; set.has(c); c = shiftDay(c, 1)) n++
    best = Math.max(best, n)
  }
  return { current, best }
}

function sanitize(raw: unknown): ProgressData {
  const out = emptyProgress()
  if (!raw || typeof raw !== 'object') return out
  const r = raw as Record<string, unknown>
  if (r.done && typeof r.done === 'object') {
    for (const [k, v] of Object.entries(r.done as Record<string, unknown>)) if (typeof v === 'number') out.done[k] = v
  }
  if (typeof r.last === 'string') out.last = r.last
  if (r.code && typeof r.code === 'object') {
    for (const [k, v] of Object.entries(r.code as Record<string, unknown>)) if (typeof v === 'string') out.code[k] = v
  }
  if (Array.isArray(r.days)) out.days = r.days.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d)).slice(-MAX_DAYS)
  const s = r.scratch as Record<string, unknown> | undefined
  if (s && typeof s === 'object') {
    if (typeof s.python === 'string') out.scratch.python = s.python
    if (typeof s.javascript === 'string') out.scratch.javascript = s.javascript
    if (s.language === 'python' || s.language === 'javascript') out.scratch.language = s.language
  }
  return out
}

export class ProgressStore {
  data: ProgressData
  private storage: KeyValueStorage | null
  private key: string
  private now: () => Date

  constructor(storage: KeyValueStorage | null, key = PROGRESS_KEY, now: () => Date = () => new Date()) {
    this.storage = storage
    this.key = key
    this.now = now
    this.data = this.read()
  }

  private read(): ProgressData {
    try {
      const text = this.storage?.getItem(this.key)
      return text ? sanitize(JSON.parse(text)) : emptyProgress()
    } catch {
      return emptyProgress()
    }
  }

  save(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.data))
    } catch {
      /* storage full or blocked: progress lasts until the window closes */
    }
  }

  isDone(id: string): boolean {
    return id in this.data.done
  }

  doneIds(): Set<string> {
    return new Set(Object.keys(this.data.done))
  }

  markDone(id: string): void {
    if (!this.isDone(id)) this.data.done[id] = this.now().getTime()
    this.touch()
    this.save()
  }

  /** Today counts as a practice day. */
  touch(): void {
    const today = dayKey(this.now())
    if (!this.data.days.includes(today)) {
      this.data.days.push(today)
      this.data.days.sort()
      if (this.data.days.length > MAX_DAYS) this.data.days = this.data.days.slice(-MAX_DAYS)
    }
  }

  streak(): { current: number; best: number } {
    return streaks(this.data.days, dayKey(this.now()))
  }

  setLast(id: string): void {
    if (this.data.last === id) return
    this.data.last = id
    this.save()
  }

  /** The learner's code for a lesson (null: untouched, use the starter). */
  getCode(id: string): string | null {
    return this.data.code[id] ?? null
  }

  /** Remember the code; the starter itself is not stored. */
  setCode(id: string, code: string, starter: string): void {
    if (code === starter) delete this.data.code[id]
    else this.data.code[id] = code
    this.save()
  }

  setScratch(language: 'python' | 'javascript', code: string): void {
    this.data.scratch[language] = code
    this.data.scratch.language = language
    this.save()
  }

  /** Forget everything. */
  reset(): void {
    this.data = emptyProgress()
    try {
      this.storage?.removeItem(this.key)
    } catch {
      /* nothing to forget */
    }
  }
}

/** Layout and font choices; kept apart so "Reset progress" leaves them alone. */
export interface Prefs {
  /** Width share of the lesson text (0.2–0.7). */
  split: number
  /** Height share of the editor in the right column (0.2–0.85). */
  editorShare: number
  font: number
  sidebar: boolean
  /** Courses folded away in the sidebar. */
  folded: string[]
}

export const DEFAULT_PREFS: Prefs = { split: 0.4, editorShare: 0.55, font: 13, sidebar: true, folded: [] }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function loadPrefs(storage: KeyValueStorage | null, key = PREFS_KEY): Prefs {
  try {
    const raw = JSON.parse(storage?.getItem(key) ?? 'null') as Partial<Prefs> | null
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS }
    return {
      split: typeof raw.split === 'number' ? clamp(raw.split, 0.2, 0.7) : DEFAULT_PREFS.split,
      editorShare: typeof raw.editorShare === 'number' ? clamp(raw.editorShare, 0.2, 0.85) : DEFAULT_PREFS.editorShare,
      font: typeof raw.font === 'number' ? clamp(Math.round(raw.font), 10, 22) : DEFAULT_PREFS.font,
      sidebar: typeof raw.sidebar === 'boolean' ? raw.sidebar : DEFAULT_PREFS.sidebar,
      folded: Array.isArray(raw.folded) ? raw.folded.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(storage: KeyValueStorage | null, prefs: Prefs, key = PREFS_KEY): void {
  try {
    storage?.setItem(key, JSON.stringify(prefs))
  } catch {
    /* not remembered */
  }
}
