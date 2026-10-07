// Line diffs: Myers' O(ND) algorithm, unified-diff text (as `git diff` prints
// it) and the added / modified / deleted line markers an editor gutter shows.

export type DiffTag = 'equal' | 'insert' | 'delete' | 'replace'

/** Lines a[a0:a1] became b[b0:b1] (half-open, 0-based) — like Python's difflib opcodes. */
export interface DiffOp {
  tag: DiffTag
  a0: number
  a1: number
  b0: number
  b1: number
}

/** Past this many edits the middle of the file is reported as one replaced block. */
const MAX_EDITS = 2000

/** Split text into lines, each keeping its "\n" (the last one may have none). */
export function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split('\n').map((l) => l + '\n')
  const last = lines.length - 1
  lines[last] = lines[last].slice(0, -1)
  if (!lines[last]) lines.pop()
  return lines
}

/** The shortest edit script from a to b, as opcodes covering both sequences. */
export function diffLines(a: readonly string[], b: readonly string[]): DiffOp[] {
  // Common head and tail are cheap to strip and usually most of the file.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let aEnd = a.length
  let bEnd = b.length
  while (aEnd > head && bEnd > head && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--
    bEnd--
  }
  const pairs = matchPairs(a, head, aEnd, b, head, bEnd)
  const ops: DiffOp[] = []
  const push = (tag: DiffTag, a0: number, a1: number, b0: number, b1: number) => {
    const last = ops[ops.length - 1]
    if (last && last.tag === tag && last.a1 === a0 && last.b1 === b0) {
      last.a1 = a1
      last.b1 = b1
    } else ops.push({ tag, a0, a1, b0, b1 })
  }
  if (head) push('equal', 0, head, 0, head)
  let i = head
  let j = head
  for (const [x, y] of pairs) {
    if (x > i || y > j) push(x > i && y > j ? 'replace' : x > i ? 'delete' : 'insert', i, x, j, y)
    push('equal', x, x + 1, y, y + 1)
    i = x + 1
    j = y + 1
  }
  if (aEnd > i || bEnd > j) push(aEnd > i && bEnd > j ? 'replace' : aEnd > i ? 'delete' : 'insert', i, aEnd, j, bEnd)
  if (aEnd < a.length) push('equal', aEnd, a.length, bEnd, b.length)
  return ops
}

/** Indices of equal lines (ascending) on the Myers path through a[aLo:aHi] × b[bLo:bHi]. */
function matchPairs(a: readonly string[], aLo: number, aHi: number, b: readonly string[], bLo: number, bHi: number): [number, number][] {
  const n = aHi - aLo
  const m = bHi - bLo
  if (!n || !m) return []
  const max = Math.min(n + m, MAX_EDITS)
  // v[k + off] = furthest x on diagonal k. trace[d] keeps v[-d-1 .. d+1] as it was before round d.
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = -1
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
  }
  if (found < 0) return [] // too different: one big replace
  const pairs: [number, number][] = []
  let x = n
  let y = m
  for (let d = found; d >= 0; d--) {
    const t = trace[d]
    const at = (k: number) => t[k + d + 1]
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = d === 0 ? 0 : at(prevK)
    const prevY = d === 0 ? 0 : prevX - prevK
    while (x > prevX && y > prevY) {
      x--
      y--
      pairs.push([aLo + x, bLo + y])
    }
    x = prevX
    y = prevY
  }
  return pairs.reverse()
}

/** Group opcodes into hunks with `context` unchanged lines around each change (difflib's get_grouped_opcodes). */
export function groupHunks(ops: DiffOp[], context = 3): DiffOp[][] {
  if (!ops.some((o) => o.tag !== 'equal')) return []
  const codes = ops.map((o) => ({ ...o }))
  const first = codes[0]
  if (first.tag === 'equal') {
    first.a0 = Math.max(first.a0, first.a1 - context)
    first.b0 = Math.max(first.b0, first.b1 - context)
  }
  const last = codes[codes.length - 1]
  if (last.tag === 'equal') {
    last.a1 = Math.min(last.a1, last.a0 + context)
    last.b1 = Math.min(last.b1, last.b0 + context)
  }
  const groups: DiffOp[][] = []
  let group: DiffOp[] = []
  for (const c of codes) {
    let { a0, b0 } = c
    if (c.tag === 'equal' && c.a1 - c.a0 > 2 * context) {
      group.push({ tag: 'equal', a0, a1: Math.min(c.a1, a0 + context), b0, b1: Math.min(c.b1, b0 + context) })
      groups.push(group)
      group = []
      a0 = Math.max(a0, c.a1 - context)
      b0 = Math.max(b0, c.b1 - context)
    }
    group.push({ tag: c.tag, a0, a1: c.a1, b0, b1: c.b1 })
  }
  if (group.length && !(group.length === 1 && group[0].tag === 'equal')) groups.push(group)
  return groups
}

function range(start: number, stop: number): string {
  const length = stop - start
  if (length === 1) return String(start + 1)
  return `${length ? start + 1 : start},${length}`
}

export interface UnifiedDiffOptions {
  /** Path shown on the --- line; null for a new file (/dev/null). */
  oldPath: string | null
  /** Path shown on the +++ line; null for a deleted file. */
  newPath: string | null
  context?: number
  /** Add the "diff --git" header line. */
  gitHeader?: boolean
}

/** A unified diff of two texts, empty when they are the same. */
export function unifiedDiff(oldText: string | null, newText: string | null, opts: UnifiedDiffOptions): string {
  const a = splitLines(oldText ?? '')
  const b = splitLines(newText ?? '')
  const hunks = groupHunks(diffLines(a, b), opts.context ?? 3)
  if (!hunks.length && (oldText === null) === (newText === null)) return ''
  const name = opts.newPath ?? opts.oldPath ?? 'file'
  const out: string[] = []
  if (opts.gitHeader) {
    out.push(`diff --git a/${opts.oldPath ?? name} b/${opts.newPath ?? name}`)
    if (oldText === null) out.push('new file mode 100644')
    if (newText === null) out.push('deleted file mode 100644')
  }
  out.push(`--- ${opts.oldPath === null || oldText === null ? '/dev/null' : `a/${opts.oldPath}`}`)
  out.push(`+++ ${opts.newPath === null || newText === null ? '/dev/null' : `b/${opts.newPath}`}`)
  const line = (prefix: string, text: string) => {
    if (text.endsWith('\n')) out.push(prefix + text.slice(0, -1).replace(/\r$/, ''))
    else {
      out.push(prefix + text.replace(/\r$/, ''))
      out.push('\\ No newline at end of file')
    }
  }
  for (const group of hunks) {
    const first = group[0]
    const last = group[group.length - 1]
    out.push(`@@ -${range(first.a0, last.a1)} +${range(first.b0, last.b1)} @@`)
    for (const op of group) {
      if (op.tag === 'equal') {
        for (let i = op.a0; i < op.a1; i++) line(' ', a[i])
        continue
      }
      for (let i = op.a0; i < op.a1; i++) line('-', a[i])
      for (let j = op.b0; j < op.b1; j++) line('+', b[j])
    }
  }
  return out.join('\n') + '\n'
}

export interface LineMarkers {
  /** 0-based lines of `current` that are new. */
  added: number[]
  /** 0-based lines of `current` that replace other lines. */
  modified: number[]
  /** 0-based lines of `current` just after which lines were removed. */
  deleted: number[]
}

/** What changed in `current` compared with `base`, line by line (for a change bar). */
export function lineMarkers(base: string, current: string): LineMarkers {
  const strip = (lines: string[]) => lines.map((l) => (l.endsWith('\n') ? l.slice(0, -1) : l).replace(/\r$/, ''))
  const b = strip(splitLines(current))
  const ops = diffLines(strip(splitLines(base)), b)
  const markers: LineMarkers = { added: [], modified: [], deleted: [] }
  const lastLine = Math.max(0, b.length - 1)
  for (const op of ops) {
    if (op.tag === 'insert') for (let j = op.b0; j < op.b1; j++) markers.added.push(j)
    else if (op.tag === 'replace') for (let j = op.b0; j < op.b1; j++) markers.modified.push(j)
    else if (op.tag === 'delete') markers.deleted.push(Math.min(op.b0, lastLine))
  }
  return markers
}

/** Git's own test: a NUL byte in the first 8000 bytes means binary. */
export function isBinary(data: Uint8Array): boolean {
  const n = Math.min(data.length, 8000)
  for (let i = 0; i < n; i++) if (data[i] === 0) return true
  return false
}
