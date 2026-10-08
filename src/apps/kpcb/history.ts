// Undo / redo over immutable designs (pure). A gesture (dragging, routing) calls begin(), then
// preview() as often as it likes, then end(): one undo step.

import type { Design } from './types.ts'

export class History {
  design: Design
  past: Design[] = []
  future: Design[] = []
  private base: Design | null = null
  private limit: number

  constructor(design: Design, limit = 200) {
    this.design = design
    this.limit = limit
  }

  get canUndo() {
    return this.past.length > 0
  }
  get canRedo() {
    return this.future.length > 0
  }
  get inGesture() {
    return this.base !== null
  }

  /** One change, one undo step. */
  commit(next: Design): void {
    if (next === this.design) return
    this.endGesture()
    this.past.push(this.design)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
    this.design = next
  }

  begin(): void {
    this.base = this.design
  }

  preview(next: Design): void {
    this.design = next
  }

  /** Close a gesture: when the design changed, it becomes one step. */
  end(): boolean {
    return this.endGesture()
  }

  cancel(): void {
    if (this.base) this.design = this.base
    this.base = null
  }

  private endGesture(): boolean {
    const b = this.base
    this.base = null
    if (b && b !== this.design) {
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
    if (!p) return false
    this.future.push(this.design)
    this.design = p
    return true
  }

  redo(): boolean {
    const f = this.future.pop()
    if (!f) return false
    this.past.push(this.design)
    this.design = f
    return true
  }

  /** Start again from a design (a new or opened file). */
  reset(design: Design): void {
    this.design = design
    this.past = []
    this.future = []
    this.base = null
  }
}
