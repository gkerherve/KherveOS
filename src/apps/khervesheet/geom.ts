// Row and column positions for the virtual grid.
//
// Most rows have the default height, so only the custom sizes are stored;
// a position is then "index × default + the extra of the custom sizes
// before it", found by binary search. Hidden rows (the filter) have size 0.

export class Axis {
  readonly count: number
  readonly def: number
  private sizes: Map<number, number>
  /** Indices with a custom size (or hidden), sorted. */
  private idx: number[] = []
  /** Extra (size − default) of idx[0..i), so pre[0] = 0. */
  private pre: number[] = [0]

  constructor(count: number, def: number, sizes: Map<number, number>, hidden?: Set<number>) {
    this.count = count
    this.def = def
    const all = new Map(sizes)
    if (hidden) for (const i of hidden) all.set(i, 0)
    this.sizes = all
    this.idx = [...all.keys()].filter((i) => i >= 0 && i < count).sort((a, b) => a - b)
    for (const i of this.idx) this.pre.push(this.pre[this.pre.length - 1] + (all.get(i)! - def))
  }

  size(i: number): number {
    return this.sizes.get(i) ?? this.def
  }

  /** How many custom indices are below i. */
  private below(i: number): number {
    let lo = 0
    let hi = this.idx.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.idx[mid] < i) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Start of index i (pixels). */
  pos(i: number): number {
    const j = Math.max(0, Math.min(i, this.count))
    return j * this.def + this.pre[this.below(j)]
  }

  /** The index at pixel offset px (clamped). */
  at(px: number): number {
    if (px <= 0) return this.firstVisible(0)
    let lo = 0
    let hi = this.count - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.pos(mid) <= px) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  total(): number {
    return this.pos(this.count)
  }

  visible(i: number): boolean {
    return this.size(i) > 0
  }

  /** The first visible index at or after i (or before, at the end). */
  firstVisible(i: number): number {
    for (let j = i; j < this.count; j++) if (this.size(j) > 0) return j
    for (let j = i - 1; j >= 0; j--) if (this.size(j) > 0) return j
    return 0
  }

  /** Step from i by `step` visible indices (negative: backwards), clamped. */
  step(i: number, step: number): number {
    let j = i
    let left = Math.abs(step)
    const d = step < 0 ? -1 : 1
    while (left > 0) {
      let k = j + d
      while (k >= 0 && k < this.count && this.size(k) === 0) k += d
      if (k < 0 || k >= this.count) break
      j = k
      left--
    }
    return j
  }
}
