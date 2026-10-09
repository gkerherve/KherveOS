// Undo / redo over immutable documents (pure). A gesture (dragging a point) calls begin(), preview() as often as it
// likes, then end(): one undo step.

export class History<T> {
  value: T
  past: T[] = []
  future: T[] = []
  private base: T | null = null
  private limit: number

  constructor(value: T, limit = 200) {
    this.value = value
    this.limit = limit
  }

  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
  get inGesture() { return this.base !== null }

  commit(next: T): void {
    if (next === this.value) return
    this.endGesture()
    this.past.push(this.value)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
    this.value = next
  }

  begin(): void { this.base = this.value }
  preview(next: T): void { this.value = next }
  end(): boolean { return this.endGesture() }
  cancel(): void { if (this.base !== null) this.value = this.base; this.base = null }

  private endGesture(): boolean {
    const b = this.base
    this.base = null
    if (b !== null && b !== this.value) {
      this.past.push(b)
      if (this.past.length > this.limit) this.past.shift()
      this.future = []
      return true
    }
    return false
  }

  undo(): boolean {
    this.endGesture()
    const p = this.past.pop()
    if (p === undefined) return false
    this.future.push(this.value)
    this.value = p
    return true
  }

  redo(): boolean {
    const f = this.future.pop()
    if (f === undefined) return false
    this.past.push(this.value)
    this.value = f
    return true
  }

  reset(value: T): void {
    this.value = value
    this.past = []
    this.future = []
    this.base = null
  }
}
