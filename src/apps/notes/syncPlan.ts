// Notes sync: what to do with each file, from three lists of content hashes
// (path relative to ~/Notes -> hash):
//
//   local   the files on this computer now
//   remote  the files on the server now; null = deleted there (a tombstone)
//   base    both sides at the last sync of this computer
//
// A side that still has the base version did not change; the other side's
// change wins. Both changed: an edit beats a deletion, and two different
// edits are a conflict (the client keeps both). A file the server does not
// know at all (no tombstone, e.g. a new server) is sent again, never deleted.
//
// Plain TypeScript: `node --test tools/tests/notes.test.ts`.

export interface SyncPlan {
  upload: string[]
  download: string[]
  deleteLocal: string[]
  deleteRemote: string[]
  conflicts: string[]
  /** The base after a sync where every step succeeds (for files that need no step). */
  base: Record<string, string>
}

export function planSync(
  local: Record<string, string>,
  remote: Record<string, string | null>,
  base: Record<string, string>,
): SyncPlan {
  const plan: SyncPlan = { upload: [], download: [], deleteLocal: [], deleteRemote: [], conflicts: [], base: {} }
  const paths = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])
  for (const p of [...paths].sort()) {
    const L = local[p] ?? null
    const known = p in remote
    const R = known ? remote[p] : null
    const B = base[p] ?? null
    if (!known) {
      // The server has never heard of it.
      if (L !== null) plan.upload.push(p)
      continue
    }
    if (L === R) {
      if (L !== null) plan.base[p] = L
      continue
    }
    if (L === B) {
      if (R === null) plan.deleteLocal.push(p)
      else plan.download.push(p)
    } else if (R === B) {
      if (L === null) plan.deleteRemote.push(p)
      else plan.upload.push(p)
    } else if (L === null) plan.download.push(p)
    else if (R === null) plan.upload.push(p)
    else plan.conflicts.push(p)
  }
  return plan
}

/** "Plan.md" -> "Plan (conflict 2026-10-08).md": where the other computer's version goes. */
export function conflictName(path: string, date: Date): string {
  const day = date.toISOString().slice(0, 10)
  const slash = path.lastIndexOf('/')
  const dir = path.slice(0, slash + 1)
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${dir}${name.slice(0, dot)} (conflict ${day})${name.slice(dot)}` : `${dir}${name} (conflict ${day})`
}
