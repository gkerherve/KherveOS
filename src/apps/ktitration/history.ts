// Undo and redo for a document held as one immutable value (pure). Edits that carry the same key and come
// quickly one after the other (typing in a field) are one undo step.

export class History<T> {
  private past: T[] = []
  private future: T[] = []
  private lastKey = ''
  private lastAt = 0

  private readonly limit: number
  private readonly window: number

  constructor(limit = 100, window = 700) {
    this.limit = limit
    this.window = window
  }

  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }

  /** Record `prev`, the value before an edit. */
  push(prev: T, key = '', now = Date.now()): void {
    this.future = []
    if (key && key === this.lastKey && now - this.lastAt < this.window && this.past.length > 0) {
      this.lastAt = now
      return
    }
    this.past.push(prev)
    if (this.past.length > this.limit) this.past.shift()
    this.lastKey = key
    this.lastAt = now
  }

  undo(current: T): T | null {
    const p = this.past.pop()
    if (p === undefined) return null
    this.future.push(current)
    this.lastKey = ''
    return p
  }

  redo(current: T): T | null {
    const f = this.future.pop()
    if (f === undefined) return null
    this.past.push(current)
    this.lastKey = ''
    return f
  }

  clear(): void {
    this.past = []
    this.future = []
    this.lastKey = ''
  }
}
