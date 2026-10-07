// The commit graph's lanes, ported from the desktop app (khervepy/commit_graph.py).
//
// Each row gets the column of its node and the line segments to draw, in
// lane / row-fraction coordinates: x is a lane index, y is 0 (top of the
// row), 0.5 (the node) or 1 (bottom).

export interface GraphCommit {
  oid: string
  parents: string[]
}

export interface Segment {
  x0: number
  y0: number
  x1: number
  y1: number
  /** Lane whose colour the segment takes. */
  color: number
}

export interface GraphRow<C extends GraphCommit = GraphCommit> {
  commit: C
  col: number
  segments: Segment[]
}

/** Commits must be newest first with children before parents (git log --topo-order). */
export function buildLanes<C extends GraphCommit>(commits: C[]): GraphRow<C>[] {
  const lanes: (string | null)[] = [] // each lane holds the oid it is heading down to
  const rows: GraphRow<C>[] = []

  const firstEmpty = () => {
    const i = lanes.indexOf(null)
    if (i >= 0) return i
    lanes.push(null)
    return lanes.length - 1
  }

  for (const c of commits) {
    const mine: number[] = []
    lanes.forEach((x, i) => x === c.oid && mine.push(i))
    const col = mine.length ? mine[0] : firstEmpty()
    lanes[col] = c.oid
    const incoming = [...lanes]

    // Other child lanes that were waiting for this commit end here.
    for (const i of mine) if (i !== col) lanes[i] = null

    const extra: number[] = []
    if (c.parents.length) {
      lanes[col] = c.parents[0]
      for (const p of c.parents.slice(1)) {
        const existing = lanes.indexOf(p)
        const pc = existing >= 0 ? existing : firstEmpty()
        lanes[pc] = p
        extra.push(pc)
      }
    } else {
      lanes[col] = null // a root commit
    }
    const outgoing = [...lanes]

    const segments: Segment[] = []
    // Top half: each incoming lane runs down to the node, or straight on.
    incoming.forEach((x, i) => {
      if (x !== null) segments.push({ x0: i, y0: 0, x1: x === c.oid ? col : i, y1: 0.5, color: i })
    })
    // Bottom half: the node fans out to its parents; other lanes pass straight.
    outgoing.forEach((x, j) => {
      if (x === null) return
      if (j === col || extra.includes(j)) segments.push({ x0: col, y0: 0.5, x1: j, y1: 1, color: j })
      else segments.push({ x0: j, y0: 0.5, x1: j, y1: 1, color: j })
    })
    rows.push({ commit: c, col, segments })

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
  }
  return rows
}

/** How many lanes wide the graph is. */
export function laneCount(rows: GraphRow[]): number {
  let w = 1
  for (const r of rows) {
    w = Math.max(w, r.col + 1)
    for (const s of r.segments) w = Math.max(w, s.x0 + 1, s.x1 + 1)
  }
  return w
}

/** Lane colours: theme variables only, so the graph follows the theme. */
export const LANE_COLORS = [
  'var(--k-accent)',
  'var(--k-link)',
  'var(--k-warning)',
  'var(--k-syn-keyword)',
  'var(--k-danger)',
  'var(--k-syn-property)',
  'var(--k-syn-type)',
  'var(--k-syn-function)',
]
