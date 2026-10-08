// Pure helpers of the KherveCAD port (no React, no OS): tested by
// tests/logic.test.mjs under plain Node.

import type { Reply, RenderJob, TreeRow, UiEvent } from './types'

const START = '\x02KC-JSON\x03'
const END = '\x02/KC-JSON\x03'

/** Events that only carry the newest state: a newer one replaces an unsent one. */
const LATEST = new Set(['sk_move', 'v3_move', 'gv_move', 'pw_move', 'v3_camera', 'sk_view', 'gv_view', 'resize', 'typing'])

/** Fold a new event into the queue. */
export function enqueue(queue: UiEvent[], ev: UiEvent): UiEvent[] {
  if (LATEST.has(ev.op)) {
    const k = queue.findIndex((q) => q.op === ev.op && (q.id ?? null) === (ev.id ?? null))
    // only replace when nothing else was queued after it (order matters for a drag)
    if (k >= 0 && k === queue.length - 1) return [...queue.slice(0, k), ev]
  }
  return [...queue, ev]
}

/** The JSON reply between the markers in *out*, or null. */
export function extractReply(out: string): Reply | null {
  const i = out.lastIndexOf(START)
  const k = i >= 0 ? out.indexOf(END, i) : -1
  if (i < 0 || k < i) return null
  return JSON.parse(out.slice(i + START.length, k)) as Reply
}

export interface FlatRow {
  row: TreeRow
  depth: number
  /** for each ancestor level: does a sibling follow (draws the guide line) */
  cont: boolean[]
}

/** A tree's visible rows in order, with their depth. */
export function flatten(rows: TreeRow[], depth = 0, cont: boolean[] = [], out: FlatRow[] = []): FlatRow[] {
  const shown = rows.filter((r) => !r.hid)
  shown.forEach((row, i) => {
    const more = i < shown.length - 1
    out.push({ row, depth, cont: [...cont, more] })
    if (row.exp && row.kids) flatten(row.kids, depth + 1, [...cont, more], out)
  })
  return out
}

/** Qt's filter "Mesh (*.stl *.obj);;STL (*.stl)" → ['.stl', '.obj'] (all groups). */
export function filterExtensions(filter: string | undefined): string[] {
  if (!filter) return []
  const exts = new Set<string>()
  for (const m of filter.matchAll(/\*\.([A-Za-z0-9]+)/g)) exts.add(`.${m[1].toLowerCase()}`)
  return [...exts]
}

/** Which waiting render job to run next: parts in order, the whole render last-wins. */
export function nextJob(queue: RenderJob[]): RenderJob | null {
  const part = queue.find((j) => j.kind === 'part')
  if (part) return part
  const renders = queue.filter((j) => j.kind === 'render')
  return renders.length ? renders[renders.length - 1] : null
}
